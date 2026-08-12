import Foundation
import Capacitor
import AVFoundation
import UIKit
import WebKit
import Photos

/// Native MP4 encoder + WKWebView snapshot capture for the replay composer.
///
/// Two flows:
///   1. Stateful session: startStoryRecord → addSnapshot ×N → finishStoryRecord
///      JS drives the replay forward and asks the plugin to grab each frame
///      directly from the WKWebView via takeSnapshot — ~10× faster than
///      modern-screenshot's SVG-foreignObject path, and frames stay in
///      native memory the entire time (no base64 round trips).
///
///   2. Direct: composeMP4 with a JS-supplied frames array (kept for the
///      legacy path).
@objc(VideoComposerPlugin)
public class VideoComposerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VideoComposerPlugin"
    public let jsName = "VideoComposer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "composeMP4",         returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareStoryVideo",    returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile",          returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startStoryRecord",   returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addSnapshot",        returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishStoryRecord",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveVideoToPhotos",  returnType: CAPPluginReturnPromise),
    ]

    // MARK: - stateful session

    private var session: RecordingSession?

    @objc func startStoryRecord(_ call: CAPPluginCall) {
        let width = call.getInt("width", 1080)
        let height = call.getInt("height", 1920)
        let frameDelayMs = call.getInt("frameDelayMs", 900)
        let bgColor = call.getString("backgroundColor")
        let bgImageBase64 = call.getString("backgroundImageBase64")
        // Where the felt should sit inside the Story canvas, in output pixels.
        let feltX = call.getDouble("feltX", 0)
        let feltY = call.getDouble("feltY", 0)
        let feltW = call.getDouble("feltW", Double(width))
        let feltH = call.getDouble("feltH", Double(height))

        // Chroma-key residual cleanup. The capsule mask handles the bulk of
        // the corner removal; chroma deals with any leftover flushed pixels
        // inside the masked area (anti-aliasing crescents, etc.). Default
        // color is magenta — virtually never appears in poker content.
        let chromaKey = call.getBool("chromaKey", false)
        let chromaR = call.getInt("chromaR", 255)
        let chromaG = call.getInt("chromaG", 0)
        let chromaB = call.getInt("chromaB", 255)
        let chromaTolerance = call.getInt("chromaTolerance", 60)

        // Rail geometry relative to the captured snapshot (0–1). The mask is
        // a capsule (rounded rect with infinite corner radius capped at half
        // the short dim) that follows the rail's outer edge plus a small
        // buffer to catch chip/card overflow.
        let railX = call.getDouble("railRelX", 0.10)
        let railY = call.getDouble("railRelY", 0.10)
        let railW = call.getDouble("railRelW", 0.80)
        let railH = call.getDouble("railRelH", 0.80)
        // Outward buffer as a fraction of snapshot dimension (e.g. 0.05 = 5%).
        let railBuffer = call.getDouble("railBuffer", 0.05)

        // Pre-render the background once into a CGImage. Solid color or photo.
        let bgImage = Self.renderBackground(
            width: width, height: height,
            color: bgColor, photoBase64: bgImageBase64
        )

        do {
            let session = try RecordingSession(
                width: width, height: height,
                frameDelayMs: frameDelayMs,
                background: bgImage,
                feltRect: CGRect(x: feltX, y: feltY, width: feltW, height: feltH),
                chromaKey: chromaKey,
                chromaColor: (UInt8(chromaR), UInt8(chromaG), UInt8(chromaB)),
                chromaTolerance: chromaTolerance,
                railRelRect: CGRect(x: railX, y: railY, width: railW, height: railH),
                railBuffer: railBuffer
            )
            self.session = session
            call.resolve([
                "ok": true,
                "chromaKey": chromaKey,
                "chromaRGB": "\(chromaR),\(chromaG),\(chromaB)",
                "tolerance": chromaTolerance,
            ])
        } catch {
            call.reject("startStoryRecord failed: \(error.localizedDescription)")
        }
    }

    @objc func addSnapshot(_ call: CAPPluginCall) {
        guard let session = self.session else {
            call.reject("No active recording session"); return
        }
        // Webview point-space rect to capture (e.g. the .replayer-table bbox).
        let x = call.getDouble("rectX", 0)
        let y = call.getDouble("rectY", 0)
        let w = call.getDouble("rectW", 0)
        let h = call.getDouble("rectH", 0)

        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("WKWebView not available"); return
            }
            // We snapshot the full WKWebView (config.rect is unreliable in
            // practice — historically iOS has ignored or mis-applied it),
            // then crop in Swift to the rect JS passed in.
            let config = WKSnapshotConfiguration()
            webView.takeSnapshot(with: config) { image, err in
                guard let image = image else {
                    call.reject("Snapshot failed: \(err?.localizedDescription ?? "nil image")"); return
                }
                // Crop to the felt rect (CSS pixel space = view point space).
                // UIImage.cgImage is in *pixel* space; convert by image.scale.
                let scale = image.scale
                let crop = CGRect(
                    x: x * Double(scale),
                    y: y * Double(scale),
                    width: w * Double(scale),
                    height: h * Double(scale)
                )
                guard let cg = image.cgImage,
                      let cropped = cg.cropping(to: crop) else {
                    call.reject("Crop failed (rect off-view?)"); return
                }
                let croppedImg = UIImage(cgImage: cropped, scale: scale, orientation: image.imageOrientation)
                do {
                    try session.appendFrame(snapshot: croppedImg)
                    call.resolve(["frame": session.frameCount])
                } catch {
                    call.reject("appendFrame failed: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc func finishStoryRecord(_ call: CAPPluginCall) {
        guard let session = self.session else {
            call.reject("No active recording session"); return
        }
        let share = call.getBool("share", false)
        let saveToPhotos = call.getBool("saveToPhotos", false)
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let url = try session.finish()
                self.session = nil
                let bytes = (try? Data(contentsOf: url).count) ?? 0

                let finishUp = { (saved: Bool, savedError: String?) in
                    if share {
                        DispatchQueue.main.async {
                            self.presentShareSheet(fileURL: url) { completed in
                                call.resolve([
                                    "path": url.path,
                                    "sizeBytes": bytes,
                                    "shared": completed,
                                    "saved": saved,
                                    "saveError": savedError as Any,
                                ])
                            }
                        }
                    } else {
                        call.resolve([
                            "path": url.path,
                            "sizeBytes": bytes,
                            "saved": saved,
                            "saveError": savedError as Any,
                        ])
                    }
                }

                if saveToPhotos {
                    self.saveVideoFileToPhotos(fileURL: url) { ok, err in
                        finishUp(ok, err)
                    }
                } else {
                    finishUp(false, nil)
                }
            } catch {
                self.session = nil
                call.reject("finish failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func saveVideoToPhotos(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing path"); return
        }
        let url = URL(fileURLWithPath: path)
        saveVideoFileToPhotos(fileURL: url) { ok, err in
            if ok { call.resolve(["saved": true]) }
            else  { call.reject(err ?? "Save failed") }
        }
    }

    private func saveVideoFileToPhotos(fileURL: URL, completion: @escaping (Bool, String?) -> Void) {
        // Defensive checks: file present + non-zero. If finishWriting reported
        // success but the file is missing/empty something else is wrong.
        let fm = FileManager.default
        if !fm.fileExists(atPath: fileURL.path) {
            completion(false, "missing-file: \(fileURL.path)"); return
        }
        let attrs = try? fm.attributesOfItem(atPath: fileURL.path)
        let size = (attrs?[.size] as? NSNumber)?.intValue ?? -1
        if size <= 0 {
            completion(false, "empty-file: size=\(size)"); return
        }

        let onAuthorized: (String) -> Void = { authMode in
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileURL)
            }) { success, error in
                if success {
                    completion(true, nil)
                } else if let e = error as NSError? {
                    completion(false, "PH(\(authMode)) \(e.domain)#\(e.code): \(e.localizedDescription)")
                } else {
                    completion(false, "PH(\(authMode)) failed: unknown (size=\(size))")
                }
            }
        }

        func describe(_ s: PHAuthorizationStatus) -> String {
            switch s {
            case .notDetermined: return "notDetermined"
            case .restricted:    return "restricted"
            case .denied:        return "denied"
            case .authorized:    return "authorized"
            case .limited:       return "limited"
            @unknown default:    return "unknown(\(s.rawValue))"
            }
        }

        if #available(iOS 14, *) {
            let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
            switch status {
            case .authorized, .limited:
                onAuthorized("addOnly:\(describe(status))")
            case .notDetermined:
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { newStatus in
                    if newStatus == .authorized || newStatus == .limited {
                        onAuthorized("addOnly:\(describe(newStatus))")
                    } else {
                        completion(false, "addOnly denied → \(describe(newStatus))")
                    }
                }
            default:
                completion(false, "addOnly status=\(describe(status)) — toggle in Settings → Photos")
            }
        } else {
            let status = PHPhotoLibrary.authorizationStatus()
            switch status {
            case .authorized:
                onAuthorized("legacy:authorized")
            case .notDetermined:
                PHPhotoLibrary.requestAuthorization { newStatus in
                    if newStatus == .authorized { onAuthorized("legacy:authorized") }
                    else { completion(false, "legacy denied → \(describe(newStatus))") }
                }
            default:
                completion(false, "legacy status=\(describe(status))")
            }
        }
    }

    // MARK: - legacy frame-array flow (kept for completeness)

    @objc func composeMP4(_ call: CAPPluginCall) {
        guard let framesBase64 = call.getArray("frames") as? [String] else {
            call.reject("Missing frames array"); return
        }
        let delayMs = call.getInt("frameDelayMs", 900)
        let width = call.getInt("width", 1080)
        let height = call.getInt("height", 1920)
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let url = try Self.encodeFramesToMP4(
                    framesBase64: framesBase64,
                    delayMs: delayMs, width: width, height: height
                )
                let data = try Data(contentsOf: url)
                call.resolve([
                    "base64": data.base64EncodedString(),
                    "sizeBytes": data.count,
                    "path": url.path,
                ])
            } catch {
                call.reject("Encode failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func shareStoryVideo(_ call: CAPPluginCall) {
        // Legacy: encode frames, then share via UIActivityViewController.
        // The previous backgroundVideo pasteboard route turned out not to be
        // an IG-honored key; this is the verified-working path.
        guard let framesBase64 = call.getArray("frames") as? [String] else {
            call.reject("Missing frames array"); return
        }
        let delayMs = call.getInt("frameDelayMs", 900)
        let width = call.getInt("width", 1080)
        let height = call.getInt("height", 1920)
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let url = try Self.encodeFramesToMP4(
                    framesBase64: framesBase64,
                    delayMs: delayMs, width: width, height: height
                )
                DispatchQueue.main.async {
                    self.presentShareSheet(fileURL: url) { completed in
                        let bytes = (try? Data(contentsOf: url).count) ?? 0
                        call.resolve(["shared": completed, "sizeBytes": bytes, "path": url.path])
                    }
                }
            } catch {
                call.reject("Encode failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func shareFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing path"); return
        }
        let url = URL(fileURLWithPath: path)
        DispatchQueue.main.async {
            self.presentShareSheet(fileURL: url) { completed in
                call.resolve(["shared": completed])
            }
        }
    }

    // MARK: - helpers

    private func presentShareSheet(fileURL: URL, completion: @escaping (Bool) -> Void) {
        guard let vc = self.bridge?.viewController else {
            completion(false); return
        }
        let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        activity.completionWithItemsHandler = { _, completed, _, _ in
            completion(completed)
        }
        // iPad popover anchor
        if let pop = activity.popoverPresentationController {
            pop.sourceView = vc.view
            pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        vc.present(activity, animated: true)
    }

    private static func renderBackground(width: Int, height: Int, color: String?, photoBase64: String?) -> CGImage? {
        let size = CGSize(width: width, height: height)
        let renderer = UIGraphicsImageRenderer(size: size)
        let img = renderer.image { ctx in
            // Solid fill
            let c = parseHexColor(color) ?? UIColor.black
            c.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            // Photo overlay — true cover-fit (fill canvas, crop overflow).
            // Old logic was CONTAIN (letterbox), which left black bars at the
            // edges. Those bars then showed through the chroma-keyed snapshot
            // corners instead of the photo.
            if let b64 = photoBase64, let data = Data(base64Encoded: stripDataPrefix(b64)),
               let photo = UIImage(data: data) {
                let iw = photo.size.width, ih = photo.size.height
                let imgAspect = iw / ih, dstAspect = size.width / size.height
                var rect: CGRect
                if imgAspect > dstAspect {
                    // Image wider than canvas → match height, overflow horizontally
                    let w = size.height * imgAspect
                    rect = CGRect(x: (size.width - w)/2, y: 0, width: w, height: size.height)
                } else {
                    // Image taller than canvas → match width, overflow vertically
                    let h = size.width / imgAspect
                    rect = CGRect(x: 0, y: (size.height - h)/2, width: size.width, height: h)
                }
                photo.draw(in: rect)
            }
        }
        return img.cgImage
    }

    private static func parseHexColor(_ s: String?) -> UIColor? {
        guard var hex = s else { return nil }
        if hex.hasPrefix("#") { hex.removeFirst() }
        guard hex.count == 6, let v = UInt32(hex, radix: 16) else { return nil }
        let r = CGFloat((v >> 16) & 0xff) / 255.0
        let g = CGFloat((v >> 8) & 0xff) / 255.0
        let b = CGFloat(v & 0xff) / 255.0
        return UIColor(red: r, green: g, blue: b, alpha: 1.0)
    }

    private static func stripDataPrefix(_ s: String) -> String {
        if let comma = s.range(of: ",") { return String(s[comma.upperBound...]) }
        return s
    }

    // MARK: - shared MP4 encoder (used by both legacy + finish())

    enum EncodeError: Error { case writerInit, invalidFrame, badPixelBuffer }

    fileprivate static func encodeFramesToMP4(
        framesBase64: [String], delayMs: Int, width: Int, height: Int
    ) throws -> URL {
        let outURL = FileManager.default.temporaryDirectory.appendingPathComponent("replay-\(UUID().uuidString).mp4")
        try? FileManager.default.removeItem(at: outURL)
        let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 8_000_000,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoMaxKeyFrameIntervalKey: 30,
            ]
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        let pxAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: pxAttrs)
        guard writer.canAdd(input) else { throw EncodeError.writerInit }
        writer.add(input)
        guard writer.startWriting() else { throw EncodeError.writerInit }
        writer.startSession(atSourceTime: .zero)
        let fps = max(Int32(1000 / max(delayMs, 1)), 1)
        let frameDuration = CMTime(value: 1, timescale: fps)
        for (i, b64) in framesBase64.enumerated() {
            let payload = stripDataPrefix(b64)
            guard let data = Data(base64Encoded: payload),
                  let img = UIImage(data: data) else { throw EncodeError.invalidFrame }
            while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }
            let buf = try pixelBuffer(from: img, width: width, height: height)
            let pts = CMTimeMultiply(frameDuration, multiplier: Int32(i))
            if !adaptor.append(buf, withPresentationTime: pts) {
                throw EncodeError.badPixelBuffer
            }
        }
        input.markAsFinished()
        let sem = DispatchSemaphore(value: 0)
        writer.finishWriting { sem.signal() }
        sem.wait()
        if writer.status != .completed { throw writer.error ?? EncodeError.writerInit }
        return outURL
    }

    fileprivate static func pixelBuffer(from image: UIImage, width: Int, height: Int) throws -> CVPixelBuffer {
        var px: CVPixelBuffer?
        let attrs: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
        ]
        let status = CVPixelBufferCreate(kCFAllocatorDefault, width, height,
                                         kCVPixelFormatType_32BGRA, attrs as CFDictionary, &px)
        guard status == kCVReturnSuccess, let buffer = px else { throw EncodeError.badPixelBuffer }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let ctx = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { throw EncodeError.badPixelBuffer }
        if let cg = image.cgImage {
            // Cover-fit
            let ir = CGFloat(cg.width) / CGFloat(cg.height)
            let dr = CGFloat(width) / CGFloat(height)
            var rect = CGRect(x: 0, y: 0, width: width, height: height)
            if ir > dr { let h = CGFloat(width)/ir; rect = CGRect(x: 0, y: (CGFloat(height)-h)/2, width: CGFloat(width), height: h) }
            else if ir < dr { let w = CGFloat(height)*ir; rect = CGRect(x: (CGFloat(width)-w)/2, y: 0, width: w, height: CGFloat(height)) }
            ctx.draw(cg, in: rect)
        }
        return buffer
    }
}

// MARK: - RecordingSession

fileprivate class RecordingSession {
    let width: Int
    let height: Int
    let frameDelayMs: Int
    let background: CGImage?
    let feltRect: CGRect
    let chromaKey: Bool
    let chromaColor: (UInt8, UInt8, UInt8)
    let chromaTolerance: Int
    // Rail position relative to the snapshot, used to build the capsule mask
    // that clips the snapshot to just the felt silhouette.
    let railRelRect: CGRect
    let railBuffer: CGFloat

    let outURL: URL
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let adaptor: AVAssetWriterInputPixelBufferAdaptor

    private(set) var frameCount: Int = 0

    init(width: Int, height: Int, frameDelayMs: Int, background: CGImage?,
         feltRect: CGRect, chromaKey: Bool = false,
         chromaColor: (UInt8, UInt8, UInt8) = (255, 0, 255),
         chromaTolerance: Int = 60,
         railRelRect: CGRect = CGRect(x: 0.10, y: 0.10, width: 0.80, height: 0.80),
         railBuffer: CGFloat = 0.05) throws {
        self.width = width
        self.height = height
        self.frameDelayMs = frameDelayMs
        self.background = background
        self.feltRect = feltRect
        self.chromaKey = chromaKey
        self.chromaColor = chromaColor
        self.chromaTolerance = chromaTolerance
        self.railRelRect = railRelRect
        self.railBuffer = railBuffer

        let url = FileManager.default.temporaryDirectory.appendingPathComponent("replay-\(UUID().uuidString).mp4")
        try? FileManager.default.removeItem(at: url)
        self.outURL = url

        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 8_000_000,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoMaxKeyFrameIntervalKey: 30,
            ]
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        let pxAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input, sourcePixelBufferAttributes: pxAttrs
        )
        guard writer.canAdd(input) else { throw VideoComposerPlugin.EncodeError.writerInit }
        writer.add(input)
        guard writer.startWriting() else { throw VideoComposerPlugin.EncodeError.writerInit }
        writer.startSession(atSourceTime: .zero)
        self.writer = writer
        self.input = input
        self.adaptor = adaptor
    }

    func appendFrame(snapshot: UIImage) throws {
        // Compose: draw background, clip to the rail capsule (scaled into
        // feltRect), then draw the snapshot. The clip handles the bulk of
        // corner removal — exact rail geometry, anti-aliased edges. Chroma
        // key, if enabled, cleans up any leftover flushed pixels inside the
        // mask (anti-aliasing crescents, chip overflow that hits the buffer
        // ring, etc.).
        let snapToDraw: UIImage
        if chromaKey, let keyed = Self.applyChromaKey(
            to: snapshot,
            keyR: chromaColor.0, keyG: chromaColor.1, keyB: chromaColor.2,
            tolerance: chromaTolerance
        ) {
            snapToDraw = keyed
        } else {
            snapToDraw = snapshot
        }

        let outSize = CGSize(width: width, height: height)
        let renderer = UIGraphicsImageRenderer(size: outSize)
        let composed = renderer.image { ctx in
            // Background layer — full canvas
            if let bg = background {
                ctx.cgContext.draw(bg, in: CGRect(origin: .zero, size: outSize))
            } else {
                UIColor.black.setFill()
                ctx.fill(CGRect(origin: .zero, size: outSize))
            }

            // Capsule mask = the rail's rect inside feltRect, expanded by
            // railBuffer. Capsule = rounded rect with corner radius = half
            // its short dimension. This clips everything outside the felt
            // silhouette so dark webview corners + chroma artifacts vanish.
            ctx.cgContext.saveGState()
            let railOriginX = feltRect.minX + railRelRect.minX * feltRect.width
            let railOriginY = feltRect.minY + railRelRect.minY * feltRect.height
            let railSizeW   = railRelRect.width  * feltRect.width
            let railSizeH   = railRelRect.height * feltRect.height
            let bufferPx    = railBuffer * min(feltRect.width, feltRect.height)
            let maskRect = CGRect(
                x: railOriginX - bufferPx,
                y: railOriginY - bufferPx,
                width: railSizeW + bufferPx * 2,
                height: railSizeH + bufferPx * 2
            )
            let cornerRadius = min(maskRect.width, maskRect.height) / 2
            let maskPath = UIBezierPath(roundedRect: maskRect, cornerRadius: cornerRadius)
            maskPath.addClip()
            snapToDraw.draw(in: feltRect)
            ctx.cgContext.restoreGState()
        }

        while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }

        let fps = max(Int32(1000 / max(frameDelayMs, 1)), 1)
        let frameDuration = CMTime(value: 1, timescale: fps)
        let pts = CMTimeMultiply(frameDuration, multiplier: Int32(frameCount))

        let buf = try VideoComposerPlugin.pixelBuffer(from: composed, width: width, height: height)
        if !adaptor.append(buf, withPresentationTime: pts) {
            throw VideoComposerPlugin.EncodeError.badPixelBuffer
        }
        frameCount += 1
    }

    func finish() throws -> URL {
        input.markAsFinished()
        let sem = DispatchSemaphore(value: 0)
        writer.finishWriting { sem.signal() }
        sem.wait()
        if writer.status != .completed {
            throw writer.error ?? VideoComposerPlugin.EncodeError.writerInit
        }
        return outURL
    }

    /// Replace pixels within `tolerance` of the key color with transparent.
    /// Returns a new UIImage with alpha or nil on failure.
    fileprivate static func applyChromaKey(
        to image: UIImage,
        keyR: UInt8, keyG: UInt8, keyB: UInt8,
        tolerance: Int
    ) -> UIImage? {
        guard let cg = image.cgImage else { return nil }
        let w = cg.width, h = cg.height
        let bytesPerRow = w * 4
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        // We render into an RGBA buffer (premultiplied last = alpha last
        // byte) so we can both READ the source and WRITE the alpha cleanly.
        var buffer = [UInt8](repeating: 0, count: h * bytesPerRow)
        guard let ctx = CGContext(
            data: &buffer, width: w, height: h, bitsPerComponent: 8,
            bytesPerRow: bytesPerRow, space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))

        let tol = tolerance
        let kr = Int(keyR), kg = Int(keyG), kb = Int(keyB)
        // Squared distance threshold — avoids per-pixel sqrt.
        let tolSq = tol * tol * 3
        let pixelCount = w * h
        buffer.withUnsafeMutableBufferPointer { ptr in
            for i in 0..<pixelCount {
                let off = i * 4
                let r = Int(ptr[off])
                let g = Int(ptr[off + 1])
                let b = Int(ptr[off + 2])
                let dr = r - kr, dg = g - kg, db = b - kb
                let dsq = dr*dr + dg*dg + db*db
                if dsq <= tolSq {
                    // Knock out: zero RGBA (premultiplied alpha = 0 ⇒ rgb 0)
                    ptr[off]     = 0
                    ptr[off + 1] = 0
                    ptr[off + 2] = 0
                    ptr[off + 3] = 0
                }
            }
        }

        guard let outCg = ctx.makeImage() else { return nil }
        return UIImage(cgImage: outCg, scale: image.scale, orientation: image.imageOrientation)
    }
}
