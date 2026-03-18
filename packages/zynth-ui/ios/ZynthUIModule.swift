import UIKit
import ZynthKit

@objc(ZynthUIModule)
final class ZynthUIModule: NSObject, ZynthModule, ZynthSyncModule {

  let name = "ZynthUI"

  var exportedMethods: [String] {
    return ["generateQRCode"]
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "generateQRCode":
      let payload = try generateQRCode(args: args)
      return ["result": payload]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "generateQRCode":
      return try generateQRCode(args: args)
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func generateQRCode(args: ZynthArgs) throws -> [String: Any] {
    let size = max(Int(args.number("size", default: 192)), 1)
    let matrix = try parseMatrix(args: args)
    if matrix.isEmpty {
      throw NSError(
        domain: "ZynthUI",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "QR matrix cannot be empty"]
      )
    }

    let darkColorRaw = args.optionalString("color") ?? "#000000"
    let lightColorRaw = args.optionalString("backgroundColor") ?? "#FFFFFF"
    let darkColor = parseColor(darkColorRaw) ?? .black
    let lightColor = parseColor(lightColorRaw) ?? .white

    guard let image = rasterizeMatrix(
      matrix: matrix,
      size: size,
      darkColor: darkColor,
      lightColor: lightColor
    ) else {
      throw NSError(
        domain: "ZynthUI",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Unable to render QR image"]
      )
    }

    guard let pngData = image.pngData() else {
      throw NSError(
        domain: "ZynthUI",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Unable to encode QR image"]
      )
    }

    return [
      "imageData": pngData.base64EncodedString(),
      "mimeType": "image/png",
      "width": size,
      "height": size
    ]
  }

  private func parseMatrix(args: ZynthArgs) throws -> [[Bool]] {
    let rawRows = try args.array("matrix")
    if rawRows.isEmpty {
      return []
    }

    var rows: [[Bool]] = []
    var expectedColumns = -1

    for rawRow in rawRows {
      guard let rowArray = rawRow as? [Any] else {
        throw NSError(
          domain: "ZynthUI",
          code: 4,
          userInfo: [NSLocalizedDescriptionKey: "QR matrix rows must be arrays"]
        )
      }

      if expectedColumns < 0 {
        expectedColumns = rowArray.count
      }
      if rowArray.count != expectedColumns {
        throw NSError(
          domain: "ZynthUI",
          code: 5,
          userInfo: [NSLocalizedDescriptionKey: "QR matrix must be square"]
        )
      }

      var rowValues: [Bool] = []
      rowValues.reserveCapacity(rowArray.count)
      for cell in rowArray {
        if let boolValue = cell as? Bool {
          rowValues.append(boolValue)
        } else if let number = cell as? NSNumber {
          rowValues.append(number.intValue != 0)
        } else {
          rowValues.append(false)
        }
      }
      rows.append(rowValues)
    }

    if rows.count != expectedColumns {
      throw NSError(
        domain: "ZynthUI",
        code: 6,
        userInfo: [NSLocalizedDescriptionKey: "QR matrix must be square"]
      )
    }

    return rows
  }

  private func rasterizeMatrix(
    matrix: [[Bool]],
    size: Int,
    darkColor: UIColor,
    lightColor: UIColor
  ) -> UIImage? {
    let moduleCount = matrix.count
    if moduleCount == 0 {
      return nil
    }

    let modulePixel = max(size / moduleCount, 1)
    let drawSize = modulePixel * moduleCount
    let drawOffset = max((size - drawSize) / 2, 0)
    let rect = CGRect(x: 0, y: 0, width: size, height: size)

    UIGraphicsBeginImageContextWithOptions(rect.size, true, 1)
    guard let context = UIGraphicsGetCurrentContext() else {
      UIGraphicsEndImageContext()
      return nil
    }

    context.setFillColor(lightColor.cgColor)
    context.fill(rect)
    context.setFillColor(darkColor.cgColor)

    for row in 0..<moduleCount {
      let values = matrix[row]
      var col = 0
      while col < values.count {
        if !values[col] {
          col += 1
          continue
        }
        let start = col
        while col < values.count && values[col] {
          col += 1
        }
        let width = (col - start) * modulePixel
        let x = drawOffset + start * modulePixel
        let y = drawOffset + row * modulePixel
        context.fill(CGRect(x: x, y: y, width: width, height: modulePixel))
      }
    }

    let image = UIGraphicsGetImageFromCurrentImageContext()
    UIGraphicsEndImageContext()
    return image
  }

  private func parseColor(_ raw: String) -> UIColor? {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty {
      return nil
    }

    if value.hasPrefix("#") {
      let hex = String(value.dropFirst())
      if hex.count == 6 {
        var parsed: UInt64 = 0
        guard Scanner(string: hex).scanHexInt64(&parsed) else {
          return nil
        }
        let red = CGFloat((parsed >> 16) & 0xFF) / 255.0
        let green = CGFloat((parsed >> 8) & 0xFF) / 255.0
        let blue = CGFloat(parsed & 0xFF) / 255.0
        return UIColor(red: red, green: green, blue: blue, alpha: 1.0)
      }

      if hex.count == 8 {
        var parsed: UInt64 = 0
        guard Scanner(string: hex).scanHexInt64(&parsed) else {
          return nil
        }
        let alpha = CGFloat((parsed >> 24) & 0xFF) / 255.0
        let red = CGFloat((parsed >> 16) & 0xFF) / 255.0
        let green = CGFloat((parsed >> 8) & 0xFF) / 255.0
        let blue = CGFloat(parsed & 0xFF) / 255.0
        return UIColor(red: red, green: green, blue: blue, alpha: alpha)
      }
    }

    return nil
  }
}
