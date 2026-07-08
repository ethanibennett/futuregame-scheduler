import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Only set the delegate here. The permission prompt is requested AFTER
        // the WebView login (see PushRegistrar.onCredsAvailable) so two alerts
        // don't compete at launch — otherwise the login prompt can't present and
        // the WebView is left blank.
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // APNs gave us a device token — hand it to the registrar to POST to the server.
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        PushRegistrar.onToken(hex)
    }
    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("[Push] APNs registration failed: \(error.localizedDescription)")
    }

    // Show notifications even while the app is in the foreground.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
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
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
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

// The console lives behind HTTP Basic Auth, which a plain Capacitor WebView
// rejects (blank screen). This registers a plugin that feeds the WebView the
// login. Credentials are held in memory for the session only — never stored.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(BasicAuthPlugin())
    }
}

@objc(BasicAuthPlugin)
public class BasicAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    // CAPBridgedPlugin conformance (required so registerPluginInstance accepts it).
    public let identifier = "BasicAuthPlugin"
    public let jsName = "BasicAuth"
    public let pluginMethods: [CAPPluginMethod] = []

    // Session-only cached credential (gone when the app is killed).
    static var cached: URLCredential?

    @objc override public func handleWKWebViewURLAuthenticationChallenge(
        _ challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) -> Bool {
        let method = challenge.protectionSpace.authenticationMethod
        guard method == NSURLAuthenticationMethodHTTPBasic ||
              method == NSURLAuthenticationMethodHTTPDigest else {
            return false // let Capacitor handle server-trust etc.
        }
        // Reuse this session's credential unless the server just rejected it.
        if challenge.previousFailureCount == 0, let cred = BasicAuthPlugin.cached {
            completionHandler(.useCredential, cred)
            return true
        }
        DispatchQueue.main.async {
            self.promptLogin(realm: challenge.protectionSpace.realm ?? "futurega.me") { cred in
                if let cred = cred {
                    BasicAuthPlugin.cached = cred
                    PushRegistrar.onCredsAvailable() // creds now known → register the APNs token
                    completionHandler(.useCredential, cred)
                } else {
                    completionHandler(.cancelAuthenticationChallenge, nil)
                }
            }
        }
        return true
    }

    private func promptLogin(realm: String, done: @escaping (URLCredential?) -> Void) {
        let alert = UIAlertController(title: "Sign in to WSOP Console",
                                      message: realm, preferredStyle: .alert)
        alert.addTextField {
            $0.placeholder = "Username"; $0.text = "ham"
            $0.autocapitalizationType = .none; $0.autocorrectionType = .no
        }
        alert.addTextField { $0.placeholder = "Password"; $0.isSecureTextEntry = true }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in done(nil) })
        alert.addAction(UIAlertAction(title: "Sign in", style: .default) { _ in
            let u = alert.textFields?.first?.text ?? ""
            let p = alert.textFields?.last?.text ?? ""
            done(URLCredential(user: u, password: p, persistence: .forSession))
        })
        topViewController()?.present(alert, animated: true)
    }

    private func topViewController() -> UIViewController? {
        var top = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows.first(where: { $0.isKeyWindow }) }
            .first?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

// Registers the APNs device token with the console server. Needs both the token
// (from APNs) and the ham credentials (from the WebView login) — whichever
// arrives second triggers the POST. The server is Basic-Auth gated, so the
// request carries the cached credentials.
enum PushRegistrar {
    static var deviceTokenHex: String?
    static var permissionRequested = false

    static func onToken(_ hex: String) {
        deviceTokenHex = hex
        sync()
    }
    // Called once the user has logged into the WebView — now it's safe to show
    // the notification permission prompt (no competing login alert).
    static func onCredsAvailable() {
        requestPermissionIfNeeded()
        sync()
    }
    static func requestPermissionIfNeeded() {
        if permissionRequested { return }
        permissionRequested = true
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            if granted {
                DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            }
        }
    }

    static func sync() {
        guard let token = deviceTokenHex,
              let cred = BasicAuthPlugin.cached,
              let user = cred.user, let pass = cred.password,
              let url = URL(string: "https://futurega.me/console/api/native/register") else { return }
        #if DEBUG
        let env = "sandbox"   // dev-signed build → APNs sandbox
        #else
        let env = "production"
        #endif
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let basic = Data("\(user):\(pass)".utf8).base64EncodedString()
        req.setValue("Basic \(basic)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token, "env": env])
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            NSLog("[Push] register token → status \(code)")
        }.resume()
    }
}
