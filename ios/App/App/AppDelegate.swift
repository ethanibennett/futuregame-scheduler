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
