import UIKit
import Capacitor
import LocalAuthentication
import AuthenticationServices
#if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
import ActivityKit
#endif

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
            DeepLinksPlugin.launchURL = url
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            if let web = activity.webpageURL { DeepLinksPlugin.launchURL = web }
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    // The app lock's privacy screen (Features 43): while the lock is on, the snapshot the app switcher
    // takes is a blur, not the Dashboard's figures. The setting is written by AppLockPlugin.
    private var privacyView: UIView?

    func sceneWillResignActive(_ scene: UIScene) {
        guard UserDefaults.standard.bool(forKey: "fgPrivacyScreen"), privacyView == nil else { return }
        guard let w = window ?? (scene as? UIWindowScene)?.windows.first else { return }
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        blur.frame = w.bounds
        blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        w.addSubview(blur)
        privacyView = blur
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyView?.removeFromSuperview()
        privacyView = nil
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

// ── App lock (Features 43, 2026-11-11) ───────────────────────────────────────
// Face ID / Touch ID with the device passcode as the fallback (.deviceOwnerAuthentication), for the
// JS lock screen (vite-app/src/utils/app-lock.js). setPrivacyScreen stores the flag SceneDelegate
// reads to blur the app-switcher snapshot. Needs NSFaceIDUsageDescription in Info.plist.
@objc(AppLockPlugin)
public class AppLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppLockPlugin"
    public let jsName = "AppLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPrivacyScreen", returnType: CAPPluginReturnPromise)
    ]

    @objc func available(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var error: NSError?
        let can = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        var bio: NSError?
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &bio)
        var kind = "passcode"
        switch ctx.biometryType {
        case .faceID: kind = "faceID"
        case .touchID: kind = "touchID"
        default: kind = "passcode"
        }
        call.resolve(["available": can, "biometry": kind])
    }

    @objc func authenticate(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Unlock futurega.me"
        let ctx = LAContext()
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
            DispatchQueue.main.async {
                call.resolve(["ok": ok])
            }
        }
    }

    @objc func setPrivacyScreen(_ call: CAPPluginCall) {
        UserDefaults.standard.set(call.getBool("enabled") ?? false, forKey: "fgPrivacyScreen")
        call.resolve()
    }
}

// ── Sign in with Apple (Features 41, 2026-11-11) ─────────────────────────────
// Apple's own sheet; the identity token goes to POST /api/auth/apple, which checks it against Apple's
// published keys. Needs the com.apple.developer.applesignin entitlement.
@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]
    private var pendingCall: CAPPluginCall?

    @objc func authorize(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pendingCall = call
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            if let nonce = call.getString("nonce") { request.nonce = nonce }
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let w = self.bridge?.viewController?.view.window { return w }
        return ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let data = cred.identityToken,
              let token = String(data: data, encoding: .utf8) else {
            call.reject("No identity token")
            return
        }
        var result: [String: Any] = ["identityToken": token, "user": cred.user]
        if let email = cred.email { result["email"] = email }
        if let given = cred.fullName?.givenName { result["givenName"] = given }
        if let family = cred.fullName?.familyName { result["familyName"] = family }
        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        let canceled = (error as NSError).code == ASAuthorizationError.canceled.rawValue
        call.reject(canceled ? "canceled" : error.localizedDescription)
    }
}

// ── Links that open in the app (Features 47, 2026-11-11) ─────────────────────
// futurega.me/h/, /shared/ and /i/ links open here when the app is installed (applinks:futurega.me in
// the entitlements, apple-app-site-association served by server.js). Capacitor's delegate proxy posts
// each opened URL; this relays it to JS as "appUrlOpen". A cold launch's link can arrive before the
// bridge exists, so SceneDelegate keeps it in launchURL for getLaunchUrl.
@objc(DeepLinksPlugin)
public class DeepLinksPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeepLinksPlugin"
    public let jsName = "DeepLinks"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getLaunchUrl", returnType: CAPPluginReturnPromise)
    ]
    static var launchURL: URL?

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(onUniversalLink(_:)), name: .capacitorOpenUniversalLink, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(onOpenURL(_:)), name: .capacitorOpenURL, object: nil)
    }

    @objc func onUniversalLink(_ note: Notification) {
        guard let obj = note.object as? [String: Any], let url = obj["url"] as? URL else { return }
        notifyListeners("appUrlOpen", data: ["url": url.absoluteString], retainUntilConsumed: true)
    }

    @objc func onOpenURL(_ note: Notification) {
        guard let obj = note.object as? [String: Any], let url = obj["url"] as? URL else { return }
        notifyListeners("appUrlOpen", data: ["url": url.absoluteString], retainUntilConsumed: true)
    }

    @objc func getLaunchUrl(_ call: CAPPluginCall) {
        if let url = DeepLinksPlugin.launchURL {
            DeepLinksPlugin.launchURL = nil
            call.resolve(["url": url.absoluteString])
        } else {
            call.resolve([:])
        }
    }
}

// ── The event you are playing on the lock screen (Features 10, 2026-11-11) ──────
// A Live Activity started when a run starts on the Dashboard, updated as the room's clock moves and ended
// at a bust, a bag or Finish. The level's end is a date, so the lock screen counts it down by itself
// (Text(timerInterval:)) with no push per second. Its UI lives in the FuturegameWidgets extension target
// (ios/App/FuturegameWidgets/), which carries the same PlayingAttributes; without that target the
// request fails and the plugin says so. iPhone only: Mac Catalyst has no Live Activities.
#if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
@available(iOS 16.2, *)
struct PlayingAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var level: Int
        var blinds: String
        var levelEndsAt: Date?
        var stack: Int
        var bigBlinds: Int?
        var lateRegClosesAt: Date?
        var note: String?
    }
    var event: String
    var room: String
}
#endif

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    @objc func available(_ call: CAPPluginCall) {
        #if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
        if #available(iOS 16.2, *) {
            call.resolve(["available": ActivityAuthorizationInfo().areActivitiesEnabled])
            return
        }
        #endif
        call.resolve(["available": false])
    }

    #if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
    @available(iOS 16.2, *)
    private func state(_ call: CAPPluginCall) -> PlayingAttributes.ContentState {
        func date(_ key: String) -> Date? {
            guard let ms = call.getDouble(key), ms > 0 else { return nil }
            return Date(timeIntervalSince1970: ms / 1000)
        }
        return PlayingAttributes.ContentState(
            level: call.getInt("level") ?? 0,
            blinds: call.getString("blinds") ?? "",
            levelEndsAt: date("levelEndsAt"),
            stack: call.getInt("stack") ?? 0,
            bigBlinds: call.getInt("bigBlinds"),
            lateRegClosesAt: date("lateRegClosesAt"),
            note: call.getString("note")
        )
    }
    #endif

    @objc func start(_ call: CAPPluginCall) {
        #if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
        if #available(iOS 16.2, *) {
            let attrs = PlayingAttributes(event: call.getString("event") ?? "Tournament", room: call.getString("room") ?? "")
            let content = ActivityContent(state: state(call), staleDate: nil)
            Task {
                for a in Activity<PlayingAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
                do {
                    let a = try Activity.request(attributes: attrs, content: content, pushType: nil)
                    call.resolve(["id": a.id])
                } catch {
                    call.reject(error.localizedDescription)
                }
            }
            return
        }
        #endif
        call.reject("Live Activities are not available here")
    }

    @objc func update(_ call: CAPPluginCall) {
        #if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
        if #available(iOS 16.2, *) {
            let content = ActivityContent(state: state(call), staleDate: nil)
            Task {
                for a in Activity<PlayingAttributes>.activities { await a.update(content) }
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }

    @objc func end(_ call: CAPPluginCall) {
        #if canImport(ActivityKit) && !targetEnvironment(macCatalyst)
        if #available(iOS 16.2, *) {
            Task {
                for a in Activity<PlayingAttributes>.activities { await a.end(nil, dismissalPolicy: .default) }
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
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
        bridge?.registerPluginInstance(AppLockPlugin())
        bridge?.registerPluginInstance(AppleSignInPlugin())
        bridge?.registerPluginInstance(DeepLinksPlugin())
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
