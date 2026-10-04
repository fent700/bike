import CoreLocation
import CoreMotion
import UIKit

/// GPS, compass and barometer for the HUD.
///
/// Foreground: every fix at best-for-navigation accuracy plus heading.
/// Background: only while a ride is recording — then location keeps running
/// (blue pill in the status bar) so distance and the track stay complete with
/// the screen locked or another app in front. Not recording and backgrounded,
/// everything stops; there is nothing to show and no reason to burn battery.
///
/// Fixes go out as plain dictionaries in the shape web/src/lib/location.js
/// documents. Barometric relative altitude rides along on each fix as `rel`,
/// which is far steadier than GPS altitude for counting climb.
@MainActor
final class LocationService: NSObject {
    var onFixes: (@MainActor ([[String: Any]]) -> Void)?
    var onHeading: (@MainActor (Double, Double) -> Void)?
    var onAuthorization: (@MainActor (String) -> Void)?

    private let manager = CLLocationManager()
    private let altimeter = CMAltimeter()
    private var started = false
    private var foreground = true
    private var recording = false
    private var updating = false
    private var headingUpdating = false
    private var altimeterRunning = false
    private var altitudeBase: Double = 0
    private var relativeAltitude: Double?
    private var backgroundSession: CLBackgroundActivitySession?
    private var lastFix: [String: Any]?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        // .fitness: no snapping to roads (bike paths aren't roads) and tuned
        // for human-powered speeds.
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        manager.headingFilter = 2

        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(orientationChanged),
            name: UIDevice.orientationDidChangeNotification,
            object: nil
        )
        orientationChanged()
    }

    var authorizationStatus: String {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: "granted"
        case .denied, .restricted: "denied"
        case .notDetermined: "pending"
        @unknown default: "pending"
        }
    }

    private var hasPermission: Bool {
        let status = manager.authorizationStatus
        return status == .authorizedWhenInUse || status == .authorizedAlways
    }

    func start() {
        started = true
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else {
            reconcile()
        }
    }

    /// Re-sends the last fix, for a page that just (re)loaded mid-ride.
    func replayLatest() {
        if let lastFix { onFixes?([lastFix]) }
    }

    func setForeground(_ active: Bool) {
        foreground = active
        reconcile()
    }

    func setRecording(_ on: Bool) {
        guard on != recording else { return }
        recording = on
        // Needs UIBackgroundModes → location in Info.plist; without it this
        // setter raises an exception at runtime rather than failing quietly.
        manager.allowsBackgroundLocationUpdates = on
        manager.showsBackgroundLocationIndicator = on
        if on {
            // iOS 17's way of saying "this when-in-use session continues in
            // the background" without asking for Always permission.
            backgroundSession = CLBackgroundActivitySession()
        } else {
            backgroundSession?.invalidate()
            backgroundSession = nil
        }
        reconcile()
    }

    /// One place decides what runs, from (permission, foreground, recording).
    private func reconcile() {
        let wantLocation = started && hasPermission && (foreground || recording)
        let wantHeading = wantLocation && foreground && CLLocationManager.headingAvailable()
        let wantAltimeter = wantLocation && recording && CMAltimeter.isRelativeAltitudeAvailable()
            && CMAltimeter.authorizationStatus() != .denied && CMAltimeter.authorizationStatus() != .restricted

        if wantLocation, !updating {
            manager.startUpdatingLocation()
            updating = true
            if manager.accuracyAuthorization == .reducedAccuracy {
                // Approximate location puts the puck somewhere in a 3 km
                // circle — useless on a bike. Ask for precise for this session.
                manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "Ride")
            }
        } else if !wantLocation, updating {
            manager.stopUpdatingLocation()
            updating = false
        }

        if wantHeading, !headingUpdating {
            manager.startUpdatingHeading()
            headingUpdating = true
        } else if !wantHeading, headingUpdating {
            manager.stopUpdatingHeading()
            headingUpdating = false
        }

        if wantAltimeter, !altimeterRunning {
            altimeterRunning = true
            altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
                guard let meters = data?.relativeAltitude.doubleValue else { return }
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.relativeAltitude = self.altitudeBase + meters
                }
            }
        } else if !wantAltimeter, altimeterRunning {
            altimeter.stopRelativeAltitudeUpdates()
            altimeterRunning = false
            // Each start reports relative to its own zero. Carrying the last
            // reading forward keeps the series continuous across a pause, or a
            // resume after descending would read as a sudden climb.
            altitudeBase = relativeAltitude ?? altitudeBase
        }
    }

    @objc private func orientationChanged() {
        // Heading is measured off the top edge of the device; a phone mounted
        // in landscape needs Core Location told which edge that now is.
        let orientation = UIDevice.current.orientation
        guard orientation.isPortrait || orientation.isLandscape,
              let mapped = CLDeviceOrientation(rawValue: Int32(orientation.rawValue))
        else { return }
        manager.headingOrientation = mapped
    }

    private func handle(_ locations: [CLLocation]) {
        // Core Location marks "no value" with negatives; JSON gets null so the
        // page never mistakes -1 m/s for a speed.
        func value(_ number: Double, valid: Bool) -> Any { valid ? number : NSNull() }

        var fixes: [[String: Any]] = []
        for location in locations {
            guard location.horizontalAccuracy >= 0, CLLocationCoordinate2DIsValid(location.coordinate) else { continue }
            let hasAltitude = location.verticalAccuracy >= 0
            var fix: [String: Any] = [:]
            fix["lat"] = location.coordinate.latitude
            fix["lon"] = location.coordinate.longitude
            fix["acc"] = location.horizontalAccuracy
            fix["alt"] = value(location.altitude, valid: hasAltitude)
            fix["vacc"] = value(location.verticalAccuracy, valid: hasAltitude)
            fix["speed"] = value(location.speed, valid: location.speed >= 0)
            fix["speedAcc"] = value(location.speedAccuracy, valid: location.speedAccuracy >= 0)
            fix["course"] = value(location.course, valid: location.course >= 0)
            fix["t"] = (location.timestamp.timeIntervalSince1970 * 1000).rounded()
            fix["rel"] = value(relativeAltitude ?? 0, valid: relativeAltitude != nil)
            fixes.append(fix)
        }
        guard let latest = fixes.last else { return }
        lastFix = latest
        onFixes?(fixes)
    }

    private func authorizationChanged() {
        onAuthorization?(authorizationStatus)
        reconcile()
    }
}

extension LocationService: CLLocationManagerDelegate {
    // CLLocation is Sendable, so the array crosses to the main actor as is.
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            self.handle(locations)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return }
        // True heading needs a location fix to correct for declination; until
        // the first fix arrives it reads -1 and magnetic is the best there is.
        let heading = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        let accuracy = newHeading.headingAccuracy
        Task { @MainActor in
            self.onHeading?(heading, accuracy)
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.authorizationChanged()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        // kCLErrorLocationUnknown is transient and Core Location keeps trying;
        // denial arrives through the authorization callback. Nothing to do.
    }

    /// The figure-eight calibration overlay would cover the HUD mid-ride.
    nonisolated func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
        false
    }
}
