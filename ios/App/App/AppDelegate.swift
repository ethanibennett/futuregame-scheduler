import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        #if targetEnvironment(macCatalyst)
        // Mac Catalyst only: a Mac window can be dragged arbitrarily small, which collapses
        // the layout. Pin a minimum below which the phone-portrait layout stops being usable.
        // Capacitor uses an app-based AppDelegate (no SceneDelegate), so there is no
        // scene(_:willConnectTo:) to set this in; instead apply it whenever a window scene
        // connects or activates, and again on didBecomeActive. Observing didActivate alone
        // (the first cut) left the window shrinkable to 515x319, so all three hooks stay.
        // `sizeRestrictions` is non-nil only on Mac. 480x720 are UIKit points: under
        // "Scale Interface to Match iPad" the Mac window floors at 370x555 screen points.
        for name in [UIScene.willConnectNotification, UIScene.didActivateNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { note in
                (note.object as? UIWindowScene).map(AppDelegate.applyWindowFloor)
            }
        }
        #endif
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        #if targetEnvironment(macCatalyst)
        application.connectedScenes.compactMap { $0 as? UIWindowScene }.forEach(AppDelegate.applyWindowFloor)
        #endif
    }

    #if targetEnvironment(macCatalyst)
    static func applyWindowFloor(_ scene: UIWindowScene) {
        scene.sizeRestrictions?.minimumSize = CGSize(width: 480, height: 720)
    }
    #endif

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // @capacitor/push-notifications: relay the APNs registration callbacks to the plugin.
    // Without these two, PushNotifications.register() never resolves and no device token ever
    // reaches the JS layer.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// iOS 26+ makes UIScene lifecycle adoption MANDATORY: an app built against that
// SDK that ships no scene manifest is killed at launch inside
// `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` (EXC_BREAKPOINT
// on the main thread) — which is exactly what crashed build 1326 on iOS 27 the
// moment the Mac's Xcode updated to the new SDK. Adopting a scene fixes it.
//
// The window and its CAPBridgeViewController are still built from Main.storyboard
// (UISceneStoryboardFile in the manifest), so this delegate does NOT create the
// UI. It only re-homes the two things the app delegate used to own that a scene
// now owns: the Mac Catalyst window floor, and deep-link delivery — once a scene
// lifecycle is in use, openURL / continue-userActivity are delivered here, not to
// the app delegate. Living in this already-compiled file keeps it out of the
// Xcode project file (no new Compile Sources entry to hand-edit).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        #if targetEnvironment(macCatalyst)
        (scene as? UIWindowScene)?.sizeRestrictions?.minimumSize = CGSize(width: 480, height: 720)
        #endif
        // A cold launch FROM a URL / universal link arrives in connectionOptions,
        // not through the openURL callbacks below.
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }

    #if targetEnvironment(macCatalyst)
    func windowScene(_ windowScene: UIWindowScene, didUpdate previousCoordinateSpace: UICoordinateSpace, interfaceOrientation previousInterfaceOrientation: UIInterfaceOrientation, traitCollection previousTraitCollection: UITraitCollection) {
        windowScene.sizeRestrictions?.minimumSize = CGSize(width: 480, height: 720)
    }
    #endif
}

// ── Instagram Stories share plugin ──────────────────────────────────────────
// Lives here, in an already-compiled source file, ON PURPOSE. The standalone
// ios/App/App/Plugins/InstagramStoriesPlugin.swift was NEVER added to the Xcode
// project's Compile Sources (0 references in project.pbxproj), so it was never
// built — the plugin did not exist at runtime, InstagramStories.shareSticker
// threw "not implemented", and the JS quietly fell back, which is why tapping
// GIF built the file but never opened Instagram. Capacitor auto-registers any
// compiled CAPBridgedPlugin via the Obj-C runtime, so compiling it here (rather
// than hand-editing the project file, which can't be verified without a build)
// makes it real.
@objc(InstagramStoriesPlugin)
public class InstagramStoriesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InstagramStoriesPlugin"
    public let jsName = "InstagramStories"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareSticker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareVideo", returnType: CAPPluginReturnPromise)
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

    // Share a full-frame 9:16 VIDEO as the Story background. Instagram's only
    // animated slot is `backgroundVideo` (the sticker slot is still-image only),
    // so an animated replay has to arrive here. The replay is already composited
    // over the chosen photo at 1080x1920 on the JS side, so this fills the whole
    // Story and Instagram opens its editor on top of it — the poster adds text,
    // stickers and music before posting. Background colors are only a fallback
    // fill for any letterboxing.
    @objc func shareVideo(_ call: CAPPluginCall) {
        guard let base64 = call.getString("videoBase64") else {
            call.reject("Missing videoBase64")
            return
        }
        guard let videoData = Data(base64Encoded: base64) else {
            call.reject("Invalid base64 data")
            return
        }

        let topColor = call.getString("backgroundTopColor") ?? "#000000"
        let bottomColor = call.getString("backgroundBottomColor") ?? "#000000"

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
            items[0]["com.instagram.sharedSticker.backgroundVideo"] = videoData
            items[0]["com.instagram.sharedSticker.backgroundTopColor"] = topColor
            items[0]["com.instagram.sharedSticker.backgroundBottomColor"] = bottomColor

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

// ── Root view controller: registers the app-local plugin ─────────────────────
// Capacitor only auto-registers its built-ins and the PACKAGE plugins listed in
// capacitor.config.json's packageClassList (registerPlugins() reads that file; it
// does NOT scan the Obj-C runtime). So a plugin defined in the app is never picked
// up, and the JS side reports 'InstagramStories plugin is not implemented on ios'
// — exactly the toast we saw, even though the class was compiled. Register it
// explicitly in capacitorDidLoad, where the bridge already exists. Main.storyboard
// instantiates this subclass as the root VC (customClass=MainViewController).
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(InstagramStoriesPlugin())
    }
}
