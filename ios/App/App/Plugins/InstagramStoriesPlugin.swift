import Foundation
import Capacitor
import UIKit

/// Capacitor plugin that shares a GIF sticker to Instagram Stories
/// via the pasteboard + URL scheme integration.
@objc(InstagramStoriesPlugin)
public class InstagramStoriesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InstagramStoriesPlugin"
    public let jsName = "InstagramStories"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareSticker", returnType: CAPPluginReturnPromise)
    ]

    @objc func shareSticker(_ call: CAPPluginCall) {
        guard let base64 = call.getString("stickerBase64") else {
            call.reject("Missing stickerBase64")
            return
        }

        guard let stickerData = Data(base64Encoded: base64) else {
            call.reject("Invalid base64 data")
            return
        }

        let topColor = call.getString("backgroundTopColor") ?? "#000000"
        let bottomColor = call.getString("backgroundBottomColor") ?? "#000000"
        // Optional background image (base64 JPEG/PNG)
        let bgBase64 = call.getString("backgroundImageBase64")

        // Instagram attributes a Stories share to the Facebook app whose ID is
        // passed as source_application, and without it it tends to ignore the
        // pasted sticker. Read the ID from Info.plist (FacebookAppID) rather
        // than hardcoding it; when it is absent we still open the bare URL and
        // let the JS side fall back to the share sheet.
        let fbAppID = (Bundle.main.object(forInfoDictionaryKey: "FacebookAppID") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        DispatchQueue.main.async {
            var urlString = "instagram-stories://share"
            if let id = fbAppID, !id.isEmpty {
                urlString += "?source_application=\(id)"
            }

            guard let url = URL(string: urlString) else {
                call.reject("Cannot create Instagram URL")
                return
            }

            guard UIApplication.shared.canOpenURL(url) else {
                call.reject("Instagram is not installed")
                return
            }

            var items: [[String: Any]] = [[:]]

            // Sticker image — the animated GIF
            items[0]["com.instagram.sharedSticker.stickerImage"] = stickerData

            // Background colors (gradient behind the sticker)
            items[0]["com.instagram.sharedSticker.backgroundTopColor"] = topColor
            items[0]["com.instagram.sharedSticker.backgroundBottomColor"] = bottomColor

            // Optional background image
            if let bgB64 = bgBase64, let bgData = Data(base64Encoded: bgB64) {
                items[0]["com.instagram.sharedSticker.backgroundImage"] = bgData
            }

            UIPasteboard.general.setItems(items, options: [
                .expirationDate: Date().addingTimeInterval(300)
            ])

            UIApplication.shared.open(url, options: [:]) { success in
                if success {
                    call.resolve(["shared": true])
                } else {
                    call.reject("Failed to open Instagram")
                }
            }
        }
    }
}
