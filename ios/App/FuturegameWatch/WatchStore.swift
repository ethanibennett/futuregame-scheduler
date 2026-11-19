// The Watch app's state: the pairing, the hands said here, and the hand being sent.

import Foundation
import SwiftUI

struct SendOutcome: Identifiable {
    let id = UUID()
    let ok: Bool
    let title: String
    let lines: [String]
    let next: String
}

@MainActor
final class WatchStore: ObservableObject {
    @Published var token: String? = Keychain.read()
    @Published var pairing: PairInfo?
    @Published var pairMessage: String?
    @Published var hands: [WatchHand] = []
    @Published var sending = false
    @Published var outcome: SendOutcome?

    var paired: Bool { token != nil }

    // ── Pairing ──

    func startPairing() async {
        pairMessage = nil
        do {
            pairing = try await WatchAPI.startPairing()
        } catch {
            pairMessage = error.localizedDescription
        }
    }

    /// Asks every 3 s whether the phone has taken the code, until it has, the code expires, or the view goes.
    func waitForPairing() async {
        while let info = pairing, token == nil, !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled, pairing?.pairId == info.pairId else { return }
            do {
                let s = try await WatchAPI.pairStatus(info.pairId)
                if s.status == "paired", let t = s.token {
                    Keychain.write(t)
                    token = t
                    pairing = nil
                    await refresh()
                    return
                }
            } catch WatchAPIError.server(404, _) {
                pairing = nil
                pairMessage = "That code expired. Ask for a new one."
                return
            } catch {
                // Offline for a moment: keep asking.
            }
        }
    }

    func cancelPairing() {
        pairing = nil
    }

    func unpair() async {
        if let t = token { await WatchAPI.unpair(token: t) }
        Keychain.delete()
        token = nil
        hands = []
    }

    private func unpaired() {
        Keychain.delete()
        token = nil
        hands = []
        pairMessage = "This Watch was unpaired. Pair it again to say hands."
    }

    // ── Hands ──

    func refresh() async {
        guard let t = token else { return }
        do {
            hands = try await WatchAPI.recent(token: t)
        } catch WatchAPIError.notPaired {
            unpaired()
        } catch {
            // Keep the list as it was.
        }
    }

    func send(_ said: String) async {
        let text = said.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let t = token, !text.isEmpty else { return }
        sending = true
        defer { sending = false }
        do {
            let r = try await WatchAPI.send(text, token: t)
            if let s = r.summary {
                outcome = SendOutcome(ok: true, title: s.title, lines: s.lines, next: s.next)
            } else {
                outcome = SendOutcome(ok: true, title: "Kept", lines: [], next: r.message ?? "It waits in Hands on your phone.")
            }
            await refresh()
        } catch WatchAPIError.notPaired {
            unpaired()
        } catch {
            outcome = SendOutcome(ok: false, title: "Not sent", lines: [error.localizedDescription], next: "What you said is not kept. Try again.")
        }
    }
}
