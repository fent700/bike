import SwiftUI
import UIKit

@main
struct BikeApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea()
                .background(Color.oled)
                // Dark scheme is what turns the status bar text white over the
                // OLED map; the HUD has no light mode to fall back to.
                .preferredColorScheme(.dark)
                // Home indicator dims after a moment instead of sitting as a
                // bright bar under the speed readout.
                .persistentSystemOverlays(.hidden)
        }
    }
}

extension Color {
    static var oled: Color { Color(red: 10 / 255, green: 10 / 255, blue: 12 / 255) }
}

extension UIColor {
    static var oled: UIColor { UIColor(red: 10 / 255, green: 10 / 255, blue: 12 / 255, alpha: 1) }
}
