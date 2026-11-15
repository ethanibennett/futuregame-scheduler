// The FuturegameWidgets extension (Features 10, 2026-11-11): the event being played as a Live Activity on the
// lock screen and in the Dynamic Island. The FuturegameWidgetsExtension target (added 2026-11-15) compiles this
// folder, which Xcode keeps in sync: any file put here joins the target. iOS 16.2, bundle id
// app.futurega.me.beta.FuturegameWidgets, embedded in the App target for iOS only (Mac Catalyst has no Live
// Activities). The App target carries NSSupportsLiveActivities and the LiveActivityPlugin
// (ios/App/App/AppDelegate.swift) that starts, updates and ends the activity.
//
// Drawn in the app's design scheme (owner, 2026-11-15): the lock screen is Home's playing card (a band of the
// venue's colour across the top with the room's name, the event in the display face, three stat boxes: blinds
// over the level, the stack over its big blinds, the level's countdown), in the colours of the theme the player
// has chosen, sent when the activity starts. A widget does not inherit its host's fonts, so the app's faces are
// bundled here (Info.plist UIAppFonts): Libre Baskerville Bold for the event, Univers Condensed for every figure
// and label. They are the app's own TTFs (vite-app/public/fonts); the Baskerville bold file is renamed
// LibreBaskerville-Bold inside, since the shipped one kept the regular face's name and iOS registers a font by it.

import WidgetKit
import SwiftUI
import ActivityKit

// Must match the App target's PlayingAttributes (AppDelegate.swift) field for field: ActivityKit decodes the
// state the app encodes.
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
    // The app's look, sent at the start: the venue band's colour (#rrggbb) and the name on it, and the chosen
    // theme's colours (surface, panel, text, muted). Optional, so an activity from an older app still decodes.
    var strip: String?
    var stripLabel: String?
    var palette: [String: String]?
}

// MARK: - The design scheme

private func hexValue(_ s: String?) -> UInt32? {
    guard var t = s?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
    if t.hasPrefix("#") { t.removeFirst() }
    guard t.count == 6 else { return nil }
    return UInt32(t, radix: 16)
}

private func rgb(_ v: UInt32) -> Color {
    Color(.sRGB, red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255,
          blue: Double(v & 0xff) / 255, opacity: 1)
}

private func rgb(_ s: String?, _ fallback: UInt32) -> Color { rgb(hexValue(s) ?? fallback) }

/// The theme's colours; the dark theme's tokens (styles.css) where the app sent none.
private struct Look {
    let surface: Color
    let panel: Color
    let text: Color
    let muted: Color
    let strip: Color

    init(_ a: PlayingAttributes) {
        let p = a.palette ?? [:]
        surface = rgb(p["surface"], 0x1a1a1a)
        panel = rgb(p["panel"], 0x242424)
        text = rgb(p["text"], 0xe8e8e8)
        muted = rgb(p["muted"], 0x828282)
        strip = rgb(a.strip, 0x3cc8e0)
    }

    /// The Dynamic Island is always black, whatever the theme: the dark theme's text colours.
    static let islandText = rgb(0xe8e8e8)
    static let islandMuted = rgb(0x828282)
}

/// The app's faces: the display face for names, Univers Condensed for every figure and label.
private enum Face {
    static func display(_ size: CGFloat) -> Font { .custom("LibreBaskerville-Bold", fixedSize: size) }
    static func figure(_ size: CGFloat) -> Font { .custom("UniversLTStd-BoldCn", fixedSize: size) }
    static func label(_ size: CGFloat) -> Font { .custom("UniversLTStd-Cn", fixedSize: size) }
}

private func levelLabel(_ s: PlayingAttributes.ContentState) -> String {
    s.level > 0 ? "Level \(s.level)" : "Blinds"
}

private func stackLabel(_ s: PlayingAttributes.ContentState) -> String {
    if let bbs = s.bigBlinds { return "\(bbs) BB" }
    return "Stack"
}

private func liveEnd(_ s: PlayingAttributes.ContentState) -> Date? {
    guard let end = s.levelEndsAt, end > Date() else { return nil }
    return end
}

// MARK: - The lock screen: Home's playing card

/// One of the card's three stat boxes: the figure over its label, on the theme's panel colour.
private struct StatBox: View {
    let look: Look
    let value: Text
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            value
                .font(Face.figure(17))
                .monospacedDigit()
                .foregroundColor(look.text)
                .multilineTextAlignment(.center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label.uppercased())
                .font(Face.label(10))
                .tracking(0.8)
                .foregroundColor(look.muted)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(look.panel))
    }
}

private struct LockScreenCard: View {
    let context: ActivityViewContext<PlayingAttributes>

    var body: some View {
        let look = Look(context.attributes)
        let s = context.state
        VStack(spacing: 0) {
            // The venue band across the top, as on Home's playing card: the room's name, white, tracked capitals.
            Text((context.attributes.stripLabel ?? context.attributes.room).uppercased())
                .font(Face.figure(11))
                .tracking(1.6)
                .foregroundColor(.white)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .frame(height: 22)
                .background(look.strip)
            VStack(alignment: .leading, spacing: 10) {
                Text(context.attributes.event)
                    .font(Face.display(15))
                    .foregroundColor(look.text)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    StatBox(look: look, value: Text(s.blinds.isEmpty ? "\u{2014}" : s.blinds), label: levelLabel(s))
                    StatBox(look: look, value: Text(s.stack > 0 ? s.stack.formatted() : "\u{2014}"), label: stackLabel(s))
                    if let end = liveEnd(s) {
                        StatBox(look: look, value: Text(timerInterval: Date()...end, countsDown: true), label: "Live")
                    } else {
                        StatBox(look: look, value: Text("\u{2014}"), label: "Clock")
                    }
                }
                if let close = s.lateRegClosesAt, close > Date() {
                    (Text("LATE REG  ").font(Face.label(11)).foregroundColor(look.muted)
                        + Text(timerInterval: Date()...close, countsDown: true).font(Face.figure(12)).foregroundColor(look.text))
                        .monospacedDigit()
                }
                if let note = s.note, !note.isEmpty {
                    Text(note)
                        .font(Face.label(11))
                        .foregroundColor(look.muted)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .activityBackgroundTint(look.surface)
        .activitySystemActionForegroundColor(look.text)
        .widgetURL(URL(string: "futurega.me://dashboard"))
    }
}

// MARK: - The widget

@main
struct FuturegameWidgetsBundle: WidgetBundle {
    var body: some Widget {
        PlayingActivityWidget()
    }
}

struct PlayingActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PlayingAttributes.self) { context in
            LockScreenCard(context: context)
        } dynamicIsland: { context in
            let look = Look(context.attributes)
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.blinds.isEmpty ? "\u{2014}" : s.blinds)
                            .font(Face.figure(17)).monospacedDigit().foregroundColor(Look.islandText)
                        Text(levelLabel(s).uppercased())
                            .font(Face.label(10)).tracking(0.8).foregroundColor(Look.islandMuted)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        if let end = liveEnd(s) {
                            Text(timerInterval: Date()...end, countsDown: true)
                                .font(Face.figure(17)).monospacedDigit().foregroundColor(Look.islandText)
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 72, alignment: .trailing)
                            Text("LIVE").font(Face.label(10)).tracking(0.8).foregroundColor(Look.islandMuted)
                        } else {
                            Text(s.stack > 0 ? s.stack.formatted() : "\u{2014}")
                                .font(Face.figure(17)).monospacedDigit().foregroundColor(Look.islandText)
                            Text(stackLabel(s).uppercased()).font(Face.label(10)).tracking(0.8).foregroundColor(Look.islandMuted)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(look.strip)
                            .frame(width: 4, height: 14)
                        Text(context.attributes.event)
                            .font(Face.display(13)).foregroundColor(Look.islandText).lineLimit(1)
                        Spacer(minLength: 4)
                        if liveEnd(s) != nil {
                            Text(s.stack > 0 ? s.stack.formatted() : "\u{2014}")
                                .font(Face.figure(13)).monospacedDigit().foregroundColor(Look.islandText)
                            + Text(s.bigBlinds.map { "  \($0) BB" } ?? "")
                                .font(Face.label(11)).foregroundColor(Look.islandMuted)
                        }
                    }
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(look.strip)
                        .frame(width: 4, height: 14)
                    Text(s.level > 0 ? "L\(s.level)" : "\u{2014}")
                        .font(Face.figure(14)).foregroundColor(Look.islandText)
                }
            } compactTrailing: {
                if let end = liveEnd(s) {
                    Text(timerInterval: Date()...end, countsDown: true)
                        .font(Face.figure(14)).monospacedDigit().foregroundColor(Look.islandText)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 44)
                } else {
                    Text(s.blinds)
                        .font(Face.figure(14)).monospacedDigit().foregroundColor(Look.islandText)
                }
            } minimal: {
                Text(s.level > 0 ? "L\(s.level)" : "FG")
                    .font(Face.figure(13)).foregroundColor(look.strip)
            }
            .keylineTint(look.strip)
            .widgetURL(URL(string: "futurega.me://dashboard"))
        }
    }
}
