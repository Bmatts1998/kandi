import Foundation
import Capacitor
import UIKit

#if canImport(DeclaredAgeRange)
import DeclaredAgeRange
#endif

@objc(DeclaredAgeRangePlugin)
public class DeclaredAgeRangePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeclaredAgeRangePlugin"
    public let jsName = "DeclaredAgeRange"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAgeRange", returnType: CAPPluginReturnPromise)
    ]

    @objc func requestAgeRange(_ call: CAPPluginCall) {
        let gate = call.getInt("ageGate") ?? 18
        DispatchQueue.main.async {
            Task { await self.performRequest(call, ageGate: gate) }
        }
    }

    @MainActor
    private func performRequest(_ call: CAPPluginCall, ageGate: Int) async {
        #if canImport(DeclaredAgeRange)
        if #available(iOS 26.0, *) {
            guard let viewController = self.bridge?.viewController else {
                call.resolve([
                    "status": "unavailable",
                    "reason": "no_view_controller"
                ])
                return
            }
            do {
                let response = try await AgeRangeService.shared.requestAgeRange(
                    ageGates: ageGate,
                    in: viewController
                )
                switch response {
                case .sharing(let range):
                    var payload: [String: Any] = ["status": "sharing"]
                    if let lower = range.lowerBound {
                        payload["lowerBound"] = lower
                    }
                    if let upper = range.upperBound {
                        payload["upperBound"] = upper
                    }
                    payload["declaration"] = String(describing: range.ageRangeDeclaration)
                    call.resolve(payload)
                case .declinedSharing:
                    call.resolve(["status": "declined"])
                @unknown default:
                    call.resolve([
                        "status": "unavailable",
                        "reason": "unknown_response"
                    ])
                }
            } catch {
                call.resolve(self.unavailablePayload(from: error))
            }
            return
        }
        #endif
        call.resolve([
            "status": "unavailable",
            "reason": "ios_version"
        ])
    }

    private func unavailablePayload(from error: Error) -> [String: Any] {
        #if canImport(DeclaredAgeRange)
        if #available(iOS 26.0, *) {
            if let serviceError = error as? AgeRangeService.Error {
                switch serviceError {
                case .notAvailable:
                    return ["status": "unavailable", "reason": "not_available"]
                case .invalidRequest:
                    return ["status": "unavailable", "reason": "invalid_request"]
                @unknown default:
                    return ["status": "unavailable", "reason": "error"]
                }
            }
        }
        #endif
        return ["status": "unavailable", "reason": "error"]
    }
}
