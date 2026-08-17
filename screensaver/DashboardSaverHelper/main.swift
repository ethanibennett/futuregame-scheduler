//
//  DashboardSaverHelper — main.swift
//
//  Resident LaunchAgent that renders the token-gated dashboard page in an OFFSCREEN
//  WKWebView and writes a snapshot PNG the DashboardSaver .saver blits. The fragile web
//  render lives HERE (non-sandboxed, network-capable); the saver only reads the local PNG.
//
//  Contract (must match DashboardSaverView.SharedPaths):
//    ~/Library/Application Support/DashboardSaver/dashboard.png            (atomic)
//    ~/Library/Application Support/DashboardSaver/dashboard.png.timestamp  (unix epoch secs)
//    ~/Library/Application Support/DashboardSaver/config.json  { "url": "...", "token": "..." }
//
//  Ready protocol (critical): the page signals readiness via data-ready="1" set on a
//  setTimeout — NOT requestAnimationFrame, which never fires in an offscreen/hidden
//  WKWebView. We poll data-ready and never wait on rAF.
//

import AppKit
import WebKit

// MARK: - Shared paths (mirror the saver's SharedPaths; getpwuid → true login home)

func realHome() -> String {
    if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
        let p = String(cString: dir)
        if !p.isEmpty { return p }
    }
    return NSHomeDirectory()
}

func supportDir() -> String {
    let dir = (realHome() as NSString)
        .appendingPathComponent("Library/Application Support/DashboardSaver")
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: nil)
    return dir
}

// MARK: - Config

struct Config { let baseURL: String; let token: String }

func loadConfig() -> Config? {
    let p = (supportDir() as NSString).appendingPathComponent("config.json")
    guard let data = FileManager.default.contents(atPath: p),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let url = (obj["url"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
          let token = (obj["token"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
          !url.isEmpty, !token.isEmpty else { return nil }
    let base = url.hasSuffix("/") ? String(url.dropLast()) : url
    return Config(baseURL: base, token: token)
}

// MARK: - Renderer

final class Renderer: NSObject, WKNavigationDelegate {
    private let config: Config
    private let webView: WKWebView
    private let window: NSWindow
    private var busy = false
    private var readyAttempts = 0

    init(config: Config) {
        self.config = config
        let (w, h) = Renderer.pixelSize()
        let rect = NSRect(x: 0, y: 0, width: w, height: h)
        webView = WKWebView(frame: rect, configuration: WKWebViewConfiguration())
        // Host the webview in an OFFSCREEN window. A fully detached WKWebView can snapshot
        // blank; a window (positioned far off any display, ordered back so it never shows)
        // gives WebKit a render context without disturbing the user.
        window = NSWindow(contentRect: rect, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = webView
        window.setFrameOrigin(NSPoint(x: -100000, y: -100000))
        window.level = .normal
        super.init()
        webView.navigationDelegate = self
        window.orderBack(nil)
        NSLog("[helper] render surface \(Int(w))x\(Int(h))")
    }

    /// Native pixel size of the main display (points × backingScaleFactor). Falls back to a
    /// retina laptop size if no screen is available.
    static func pixelSize() -> (CGFloat, CGFloat) {
        if let s = NSScreen.main {
            let scale = s.backingScaleFactor
            return (max(1, s.frame.width * scale), max(1, s.frame.height * scale))
        }
        return (2880, 1800)
    }

    func render() {
        guard !busy else { NSLog("[helper] skip: previous render still in flight"); return }
        busy = true
        readyAttempts = 0
        guard let url = URL(string: config.baseURL + "/d/" + config.token) else {
            NSLog("[helper] bad url"); busy = false; return
        }
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        req.timeoutInterval = 20
        NSLog("[helper] loading \(config.baseURL)/d/****")
        webView.load(req)
    }

    func webView(_ wv: WKWebView, didFinish nav: WKNavigation!) { pollReady() }
    func webView(_ wv: WKWebView, didFail nav: WKNavigation!, withError e: Error) { fail("didFail", e) }
    func webView(_ wv: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) { fail("provisional", e) }

    private func fail(_ stage: String, _ e: Error) {
        NSLog("[helper] navigation failed (\(stage)): \(e.localizedDescription)")
        busy = false
    }

    /// Poll data-ready="1" (never rAF). The page always signals ready — even on total fetch
    /// failure — so this resolves; the timeout is only a safety net.
    private func pollReady() {
        readyAttempts += 1
        webView.evaluateJavaScript("document.documentElement.getAttribute('data-ready')") { [weak self] res, _ in
            guard let self = self else { return }
            if let s = res as? String, s == "1" {
                // Small settle so the final layout/canvas paint lands before the snapshot.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.snapshot() }
            } else if self.readyAttempts < 80 { // ~8s at 100ms
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.pollReady() }
            } else {
                NSLog("[helper] data-ready timed out after \(self.readyAttempts) polls; snapshotting anyway")
                self.snapshot()
            }
        }
    }

    private func snapshot() {
        let cfg = WKSnapshotConfiguration()
        cfg.rect = webView.bounds
        webView.takeSnapshot(with: cfg) { [weak self] image, error in
            guard let self = self else { return }
            defer { self.busy = false }
            guard let image = image else {
                NSLog("[helper] snapshot returned nil: \(String(describing: error))"); return
            }
            self.write(image)
        }
    }

    private func write(_ image: NSImage) {
        guard let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            NSLog("[helper] png encode failed"); return
        }
        let dir = supportDir()
        let pngPath = (dir as NSString).appendingPathComponent("dashboard.png")
        let tsPath = (dir as NSString).appendingPathComponent("dashboard.png.timestamp")
        do {
            // Data.write(.atomic) writes to a temp file then renames — the saver only ever
            // sees a complete PNG, and the mtime bump is what triggers its reload.
            try png.write(to: URL(fileURLWithPath: pngPath), options: .atomic)
            try String(Int(Date().timeIntervalSince1970))
                .write(toFile: tsPath, atomically: true, encoding: .utf8)
            NSLog("[helper] wrote frame \(rep.pixelsWide)x\(rep.pixelsHigh) (\(png.count) bytes)")
        } catch {
            NSLog("[helper] write failed: \(error.localizedDescription)")
        }
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var renderer: Renderer?
    private var timer: Timer?

    func applicationDidFinishLaunching(_ note: Notification) {
        guard let config = loadConfig() else {
            NSLog("[helper] missing/invalid config.json at \(supportDir())/config.json — exiting")
            exit(1)
        }
        let r = Renderer(config: config)
        renderer = r
        r.render()
        // Resident agent: re-render every 60s. KeepAlive in the LaunchAgent restarts us if we die.
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in r.render() }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // no dock icon / menu bar
let delegate = AppDelegate()
app.delegate = delegate
app.run()
