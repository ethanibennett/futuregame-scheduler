// futurega.me on the Apple Watch: say a hand, and finish it later in Hands on the phone (lib/watch.js).

import SwiftUI

@main
struct FuturegameWatchApp: App {
    @StateObject private var store = WatchStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: WatchStore

    var body: some View {
        NavigationStack {
            if store.paired {
                HomeView()
            } else {
                PairView()
            }
        }
    }
}

/// Pairing: a code shown here, typed into the phone app (Settings › Apple Watch).
struct PairView: View {
    @EnvironmentObject var store: WatchStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if let info = store.pairing {
                    Text("On your phone: futurega.me › Settings › Apple Watch. Type:")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text(spaced(info.code))
                        .font(.system(size: 30, weight: .semibold, design: .monospaced))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                    Button("Cancel", role: .cancel) { store.cancelPairing() }
                } else {
                    Text("Say hands here and finish them on your phone.")
                        .font(.footnote)
                    if let m = store.pairMessage {
                        Text(m).font(.footnote).foregroundStyle(.orange)
                    }
                    Button {
                        Task { await store.startPairing() }
                    } label: {
                        Label("Pair", systemImage: "applewatch")
                    }
                }
            }
        }
        .navigationTitle("futurega.me")
        .task(id: store.pairing?.pairId) {
            if store.pairing != nil { await store.waitForPairing() }
        }
    }

    private func spaced(_ code: String) -> String {
        guard code.count == 6 else { return code }
        return String(code.prefix(3)) + " " + String(code.suffix(3))
    }
}

/// Say a hand: the system's own text input (dictation first), then what the server understood.
struct HomeView: View {
    @EnvironmentObject var store: WatchStore
    @State private var confirmUnpair = false

    var body: some View {
        List {
            Section {
                if store.sending {
                    HStack {
                        ProgressView()
                        Text("Reading the hand…").font(.footnote)
                    }
                } else {
                    TextFieldLink(prompt: Text("Say the hand, street by street")) {
                        Label("Say a hand", systemImage: "mic.fill")
                    } onSubmit: { said in
                        Task { await store.send(said) }
                    }
                }
            }
            if !store.hands.isEmpty {
                Section("Recent") {
                    ForEach(store.hands) { hand in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(hand.summary?.title ?? String(hand.text.prefix(40)))
                                .font(.footnote)
                                .lineLimit(1)
                            Text(statusLine(hand))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }
            }
            Section {
                Button("Unpair", role: .destructive) { confirmUnpair = true }
            }
        }
        .navigationTitle("Hands")
        .task { await store.refresh() }
        .sheet(item: $store.outcome) { outcome in
            OutcomeView(outcome: outcome)
        }
        .confirmationDialog("Unpair this Watch?", isPresented: $confirmUnpair) {
            Button("Unpair", role: .destructive) { Task { await store.unpair() } }
        }
    }

    private func statusLine(_ hand: WatchHand) -> String {
        switch hand.status {
        case "done": return "Saved"
        case "parsed":
            if let q = hand.summary?.questions { return q == 0 ? "Ready to save on your phone" : "\(q) question\(q == 1 ? "" : "s") on your phone" }
            return "Waiting on your phone"
        case "failed": return "Not read yet: open it on your phone"
        default: return "Waiting on your phone"
        }
    }
}

struct OutcomeView: View {
    let outcome: SendOutcome
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Label(outcome.title, systemImage: outcome.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .font(.headline)
                    .foregroundStyle(outcome.ok ? Color.green : Color.orange)
                ForEach(outcome.lines, id: \.self) { line in
                    Text(line).font(.footnote)
                }
                Text(outcome.next)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Done") { dismiss() }
                    .padding(.top, 4)
            }
        }
    }
}
