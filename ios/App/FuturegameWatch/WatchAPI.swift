// futurega.me on the Apple Watch (owner, 2026-11-19: "Apple Watch: dictation through quick add").
// The server half is lib/watch.js: the Watch pairs by a six-digit code typed into the phone app (Settings ›
// Apple Watch), then sends what was said to POST /api/watch/hands, where quick add reads it as speech.
// The Watch's token opens /api/watch/* only and lives in the Keychain.

import Foundation
import Security
import WatchKit

struct PairInfo: Decodable { let pairId: String; let code: String; let expiresAt: Double }
struct PairStatus: Decodable { let status: String; let token: String? }
struct HandSummary: Decodable, Hashable { let title: String; let lines: [String]; let questions: Int?; let next: String }
struct SendResult: Decodable { let id: Int; let status: String; let summary: HandSummary?; let kept: Bool?; let message: String? }
struct WatchHand: Decodable, Identifiable, Hashable {
    let id: Int
    let createdAt: Double
    let status: String
    let text: String
    let summary: HandSummary?
    let error: String?
}
struct HandList: Decodable { let hands: [WatchHand] }
private struct ServerError: Decodable { let error: String? }

enum WatchAPIError: LocalizedError {
    case server(Int, String)
    case notPaired
    case offline

    var errorDescription: String? {
        switch self {
        case .server(_, let message): return message
        case .notPaired: return "This Watch is not paired."
        case .offline: return "No connection. Try again."
        }
    }
}

/// The Watch's token, in the Keychain (never in user defaults).
enum Keychain {
    private static let service = "me.futurega.watch"
    private static let account = "token"

    static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String) {
        delete()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: Data(value.utf8),
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum WatchAPI {
    static let base = URL(string: "https://futurega.me")!

    static func call<T: Decodable>(_ method: String, _ path: String, token: String? = nil, body: [String: Any]? = nil, timeout: TimeInterval = 40) async throws -> T {
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = timeout
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw WatchAPIError.offline
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw WatchAPIError.notPaired }
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.error ?? "Something went wrong (\(status))."
            throw WatchAPIError.server(status, message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func startPairing() async throws -> PairInfo {
        try await call("POST", "api/watch/pair", body: ["device": WKInterfaceDevice.current().name])
    }

    static func pairStatus(_ pairId: String) async throws -> PairStatus {
        try await call("GET", "api/watch/pair/\(pairId)")
    }

    /// The server keeps the hand at once and reads it (up to about 25 s) before it answers.
    static func send(_ text: String, token: String) async throws -> SendResult {
        try await call("POST", "api/watch/hands", token: token, body: ["text": text], timeout: 45)
    }

    static func recent(token: String) async throws -> [WatchHand] {
        let list: HandList = try await call("GET", "api/watch/hands", token: token)
        return list.hands
    }

    static func unpair(token: String) async {
        struct Ok: Decodable { let ok: Bool? }
        let _: Ok? = try? await call("DELETE", "api/watch/self", token: token)
    }
}
