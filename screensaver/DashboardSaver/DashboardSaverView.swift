//
//  DashboardSaverView.swift
//  DashboardSaver
//
//  A minimal ScreenSaverView that blits a pre-rendered dashboard PNG produced by the
//  DashboardSaver LaunchAgent helper. It performs NO network I/O and hosts NO WKWebView,
//  so it is immune to the macOS 26 legacyScreenSaver WKWebView-blank/occlusion bugs.
//
//  Principal class (Info.plist NSPrincipalClass): DashboardSaver.DashboardSaverView
//

import ScreenSaver
import AppKit
import CoreGraphics

// MARK: - Shared paths

private enum SharedPaths {
    /// Real home directory. In a sandboxed screensaver helper NSHomeDirectory() can be
    /// redirected into a container; getpwuid recovers the actual login home so we read the
    /// same file the (non-sandboxed) helper wrote.
    static var realHome: String {
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
            let path = String(cString: dir)
            if !path.isEmpty { return path }
        }
        return NSHomeDirectory()
    }

    static var supportDir: String {
        (realHome as NSString)
            .appendingPathComponent("Library/Application Support/DashboardSaver")
    }

    static var pngPath: String {
        (supportDir as NSString).appendingPathComponent("dashboard.png")
    }

    static var timestampPath: String {
        (supportDir as NSString).appendingPathComponent("dashboard.png.timestamp")
    }
}

// MARK: - Console palette (mirrors tokens.css so the letterbox/overlay match the page)

private enum Palette {
    static let ink       = NSColor(srgbRed: 0x11 / 255.0, green: 0x11 / 255.0, blue: 0x11 / 255.0, alpha: 1)
    static let surface   = NSColor(srgbRed: 0x1a / 255.0, green: 0x1a / 255.0, blue: 0x1a / 255.0, alpha: 1)
    static let bone      = NSColor(srgbRed: 0xe8 / 255.0, green: 0xe8 / 255.0, blue: 0xe8 / 255.0, alpha: 1)
    static let muted     = NSColor(srgbRed: 0x80 / 255.0, green: 0x80 / 255.0, blue: 0x80 / 255.0, alpha: 1)
    static let warn      = NSColor(srgbRed: 0xb8 / 255.0, green: 0x96 / 255.0, blue: 0x2e / 255.0, alpha: 1)
}

// MARK: - Single-instance guard (lifecycle hygiene, Finding 1)

/// legacyScreenSaver can, on some builds, leave a stale ScreenSaverView instance running
/// after `willstop`. Our instances hold no timers/webviews/sockets, so a stale one is
/// harmless (worst case: it redraws a static PNG). We still track the "active" instance so
/// only the most recent one bothers to reload the image, and we stop cleanly on willstop.
private final class InstanceRegistry {
    static let shared = InstanceRegistry()
    private let lock = NSLock()
    private weak var active: DashboardSaverView?

    func makeActive(_ view: DashboardSaverView) {
        lock.lock(); active = view; lock.unlock()
    }
    func isActive(_ view: DashboardSaverView) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return active === view
    }
    func resign(_ view: DashboardSaverView) {
        lock.lock(); if active === view { active = nil }; lock.unlock()
    }
}

// MARK: - The saver view

@objc(DashboardSaverView)
final class DashboardSaverView: ScreenSaverView {

    /// How long (seconds) before a frame is considered stale and we show the warning badge.
    private let staleThreshold: TimeInterval = 10 * 60

    /// Loaded frame + the mtime it was loaded from (so we only reload on change).
    /// NB: named `frameImage`, not `frame` — NSView already declares `frame: NSRect`.
    private var frameImage: NSImage?
    private var loadedModified: Date?
    private var loadedTimestamp: Date?   // parsed from the .timestamp sidecar (frame data time)
    private var lastPollAt: TimeInterval = 0
    private var didRegisterNotifications = false

    // MARK: Init

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        // Redraw roughly once per second: enough to pick up a new PNG and refresh the
        // "as of" clock; light enough that a stale instance costs nothing. This is a slow
        // heartbeat, NOT per-frame animation.
        animationTimeInterval = 1.0
        wantsLayer = true
        layer?.backgroundColor = Palette.ink.cgColor
        registerNotificationsIfNeeded()
        InstanceRegistry.shared.makeActive(self)
        loadFrameIfChanged(force: true)
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        animationTimeInterval = 1.0
        wantsLayer = true
        layer?.backgroundColor = Palette.ink.cgColor
        registerNotificationsIfNeeded()
        InstanceRegistry.shared.makeActive(self)
        loadFrameIfChanged(force: true)
    }

    deinit {
        InstanceRegistry.shared.resign(self)
        DistributedNotificationCenter.default().removeObserver(self)
    }

    // MARK: Lifecycle hygiene

    private func registerNotificationsIfNeeded() {
        guard !didRegisterNotifications else { return }
        didRegisterNotifications = true
        // Some macOS builds don't reliably call stopAnimation() on the right instance;
        // listen for the system's screensaver stop broadcast and shut ourselves down.
        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(handleWillStop(_:)),
            name: NSNotification.Name("com.apple.screensaver.willstop"),
            object: nil
        )
    }

    @objc private func handleWillStop(_ note: Notification) {
        stopAnimation()
        InstanceRegistry.shared.resign(self)
    }

    override func startAnimation() {
        super.startAnimation()
        InstanceRegistry.shared.makeActive(self)
        loadFrameIfChanged(force: true)
    }

    override func stopAnimation() {
        super.stopAnimation()
    }

    // MARK: Frame loading

    /// Reload the PNG only if its modification date changed since we last read it.
    /// Cheap enough to call every animation tick.
    private func loadFrameIfChanged(force: Bool) {
        let fm = FileManager.default
        let path = SharedPaths.pngPath
        guard let attrs = try? fm.attributesOfItem(atPath: path),
              let modified = attrs[.modificationDate] as? Date else {
            // No PNG yet (helper hasn't produced a first frame). Keep whatever we have.
            if force { frameImage = nil; loadedModified = nil }
            return
        }
        if !force, let prev = loadedModified, prev == modified { return }

        // Load off the main thread would be nicer, but PNG decode of one frame is trivial
        // and draw() must have the image synchronously; a screensaver tick tolerates this.
        if let img = NSImage(contentsOfFile: path), img.size.width > 0, img.size.height > 0 {
            frameImage = img
            loadedModified = modified
            loadedTimestamp = readTimestampSidecar()
        }
    }

    /// Parse the unix-epoch-seconds sidecar the helper writes. Returns nil if absent/garbage.
    private func readTimestampSidecar() -> Date? {
        guard let raw = try? String(contentsOfFile: SharedPaths.timestampPath, encoding: .utf8)
        else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let secs = TimeInterval(trimmed) else { return nil }
        return Date(timeIntervalSince1970: secs)
    }

    // MARK: Animation heartbeat

    override func animateOneFrame() {
        // Only the active instance polls the filesystem; stale instances just idle.
        guard InstanceRegistry.shared.isActive(self) else { return }
        let now = CACurrentMediaTime()
        // Poll the PNG at most ~once/sec (animationTimeInterval already paces us, this is a
        // guard in case the system speeds up the timer).
        if now - lastPollAt >= 0.9 {
            lastPollAt = now
            loadFrameIfChanged(force: false)
        }
        setNeedsDisplay(bounds)
    }

    // MARK: Drawing

    override func draw(_ rect: NSRect) {
        // 1. Fill the console ink background (also the letterbox color).
        Palette.ink.setFill()
        bounds.fill()

        guard let image = frameImage else {
            drawPlaceholder(in: bounds)
            return
        }

        // 2. Aspect-fit the PNG, centered.
        let dst = aspectFitRect(imageSize: image.size, in: bounds)
        image.draw(in: dst,
                   from: .zero,
                   operation: .sourceOver,
                   fraction: 1.0,
                   respectFlipped: true,
                   hints: [.interpolation: NSImageInterpolation.high.rawValue])

        // 3. Staleness overlay ("as of HH:MM", plus STALE badge if too old).
        drawTimestampOverlay(imageRect: dst)
    }

    private func drawPlaceholder(in rect: NSRect) {
        // No frame available yet: quiet, on-brand "waiting" state (not an error scream).
        let msg = "DASHBOARD LOADING…"
        let para = NSMutableParagraphStyle()
        para.alignment = .center
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont(name: "Univers Condensed", size: max(14, rect.height * 0.02))
                ?? NSFont.systemFont(ofSize: max(14, rect.height * 0.02), weight: .light),
            .foregroundColor: Palette.muted,
            .kern: 3.0,
            .paragraphStyle: para,
        ]
        let size = (msg as NSString).size(withAttributes: attrs)
        let origin = NSRect(x: 0,
                            y: rect.midY - size.height / 2,
                            width: rect.width,
                            height: size.height)
        (msg as NSString).draw(in: origin, withAttributes: attrs)
    }

    private func drawTimestampOverlay(imageRect: NSRect) {
        guard let ts = loadedTimestamp else { return }
        let age = Date().timeIntervalSince(ts)
        let isStale = age > staleThreshold

        let df = DateFormatter()
        df.dateFormat = "HH:mm"
        let label = isStale
            ? "STALE · AS OF \(df.string(from: ts))"
            : "AS OF \(df.string(from: ts))"

        let fontSize = max(11, bounds.height * 0.014)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont(name: "Univers Condensed", size: fontSize)
                ?? NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular),
            .foregroundColor: isStale ? Palette.warn : Palette.muted,
            .kern: 2.0,
        ]
        let str = label as NSString
        let textSize = str.size(withAttributes: attrs)
        let pad: CGFloat = fontSize
        // Bottom-right of the image content rect.
        let x = imageRect.maxX - textSize.width - pad
        let y = imageRect.minY + pad
        // Subtle scrim so the text stays legible over any chart pixels.
        let scrim = NSRect(x: x - pad * 0.5,
                          y: y - pad * 0.35,
                          width: textSize.width + pad,
                          height: textSize.height + pad * 0.7)
        NSColor(srgbRed: 0.066, green: 0.066, blue: 0.066, alpha: 0.72).setFill()
        NSBezierPath(roundedRect: scrim, xRadius: 4, yRadius: 4).fill()
        str.draw(at: NSPoint(x: x, y: y), withAttributes: attrs)
    }

    // MARK: Geometry

    private func aspectFitRect(imageSize: NSSize, in container: NSRect) -> NSRect {
        guard imageSize.width > 0, imageSize.height > 0 else { return container }
        let scale = min(container.width / imageSize.width,
                        container.height / imageSize.height)
        let w = imageSize.width * scale
        let h = imageSize.height * scale
        return NSRect(x: container.midX - w / 2,
                      y: container.midY - h / 2,
                      width: w,
                      height: h)
    }

    // MARK: Configuration sheet (none)

    override var hasConfigureSheet: Bool { false }
    override var configureSheet: NSWindow? { nil }
}
