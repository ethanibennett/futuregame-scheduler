import Foundation
import Capacitor

/// CAPBridgeViewController subclass that explicitly registers local plugins.
///
/// Capacitor's default registration path uses `NSClassFromString` against
/// names in `packageClassList`. That lookup is brittle for Swift classes —
/// even with `@objc(InstagramStoriesPlugin)` it can resolve to nil if the
/// class isn't materialized at bridge init. Direct instance registration
/// via `capacitorDidLoad()` bypasses the string lookup entirely.
@objc(MainViewController)
public class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(InstagramStoriesPlugin())
        bridge?.registerPluginInstance(VideoComposerPlugin())
    }
}
