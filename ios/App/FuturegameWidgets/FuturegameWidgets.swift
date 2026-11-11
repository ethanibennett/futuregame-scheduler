// The FuturegameWidgets extension (Features 10, 2026-11-11): the event being played as a Live Activity on the
// lock screen and in the Dynamic Island. NOT YET IN THE XCODE PROJECT: on the Mac, File > New > Target >
// Widget Extension named FuturegameWidgets (Include Live Activity on, Configuration Intent off), delete the
// template's Swift files, add this folder's files to the new target only, set its deployment target to 16.2
// and its bundle id to app.futurega.me.beta.FuturegameWidgets, and embed it in the App target. Signing is
// automatic, like the app's. The App target already carries NSSupportsLiveActivities and the
// LiveActivityPlugin (ios/App/App/AppDelegate.swift) that starts, updates and ends the activity.

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
}

@main
struct FuturegameWidgetsBundle: WidgetBundle {
    var body: some Widget {
        PlayingActivityWidget()
    }
}

struct PlayingActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PlayingAttributes.self) { context in
            // The lock screen.
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(context.attributes.event).font(.headline).lineLimit(1)
                    Spacer()
                    Text(context.attributes.room).font(.caption).foregroundColor(.secondary).lineLimit(1)
                }
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading) {
                        Text("Level \(context.state.level)").font(.caption).foregroundColor(.secondary)
                        Text(context.state.blinds).font(.title3).bold().monospacedDigit()
                    }
                    Spacer()
                    if let end = context.state.levelEndsAt, end > Date() {
                        Text(timerInterval: Date()...end, countsDown: true)
                            .font(.title2).monospacedDigit().multilineTextAlignment(.trailing)
                    }
                }
                HStack {
                    Text("\(context.state.stack.formatted())").monospacedDigit()
                    if let bbs = context.state.bigBlinds { Text("· \(bbs) BB").foregroundColor(.secondary) }
                    Spacer()
                    if let close = context.state.lateRegClosesAt, close > Date() {
                        Text("Late reg ") + Text(timerInterval: Date()...close, countsDown: true)
                    }
                }
                .font(.subheadline)
                if let note = context.state.note { Text(note).font(.caption).foregroundColor(.secondary) }
            }
            .padding()
            .widgetURL(URL(string: "futurega.me://dashboard"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading) {
                        Text("Level \(context.state.level)").font(.caption)
                        Text(context.state.blinds).bold().monospacedDigit()
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let end = context.state.levelEndsAt, end > Date() {
                        Text(timerInterval: Date()...end, countsDown: true).monospacedDigit().frame(maxWidth: 64)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.attributes.event).lineLimit(1)
                        Spacer()
                        Text("\(context.state.stack.formatted())").monospacedDigit()
                    }.font(.caption)
                }
            } compactLeading: {
                Text("L\(context.state.level)").bold()
            } compactTrailing: {
                if let end = context.state.levelEndsAt, end > Date() {
                    Text(timerInterval: Date()...end, countsDown: true).monospacedDigit().frame(maxWidth: 44)
                } else {
                    Text(context.state.blinds).monospacedDigit()
                }
            } minimal: {
                Text("L\(context.state.level)")
            }
        }
    }
}
