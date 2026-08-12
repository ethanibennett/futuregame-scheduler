#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(VideoComposerPlugin, "VideoComposer",
    CAP_PLUGIN_METHOD(composeMP4, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(shareStoryVideo, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(shareFile, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(startStoryRecord, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(addSnapshot, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(finishStoryRecord, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(saveVideoToPhotos, CAPPluginReturnPromise);
)
