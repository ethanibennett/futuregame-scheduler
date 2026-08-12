// Capacitor plugin registration for InstagramStoriesPlugin.
//
// The CAP_PLUGIN macro is what wires the Swift implementation into
// Capacitor's runtime plugin registry under the JS name "InstagramStories".
// Without it, Capacitor's bridge logs "plugin is not implemented on ios"
// even though the Swift class is present in the binary.
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(InstagramStoriesPlugin, "InstagramStories",
    CAP_PLUGIN_METHOD(shareSticker, CAPPluginReturnPromise);
)
