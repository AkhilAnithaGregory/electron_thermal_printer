const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const pdfToPrinter = require("pdf-to-printer");
const os = require("os");

const app = express();
app.use(bodyParser.json({ limit: "20mb" }));

app.post("/print", async (req, res) => {
  console.log("Request received");

  try {
    const { pdfBase64, imageBase64, printernamefromfrontend } = req.body;

    if (!pdfBase64 && !imageBase64) {
      return res.status(400).json({
        message:
          'Missing "pdfBase64" or "imageBase64" field in the request body.',
      });
    }

    if (!printernamefromfrontend || !Array.isArray(printernamefromfrontend)) {
      return res.status(400).json({
        message:
          'Missing or invalid "printernamefromfrontend". Must be an array of printer names.',
      });
    }

    let binaryData;

    if (imageBase64) {
      const imageBytes = Buffer.from(
        imageBase64.replace(/^data:image\/\w+;base64,/, ""),
        "base64"
      );

      const pdfDoc = await PDFDocument.create();
      const isPng = imageBase64.startsWith("data:image/png");
      const embeddedImage = isPng
        ? await pdfDoc.embedPng(imageBytes)
        : await pdfDoc.embedJpg(imageBytes);

      const imgWidth = embeddedImage.width;
      const imgHeight = embeddedImage.height;

      const targetWidth = 226.77;
      const scale = targetWidth / imgWidth;
      const scaledHeight = imgHeight * scale;
      const minHeight = 500;
      const finalHeight = Math.max(scaledHeight, minHeight);

      const page = pdfDoc.addPage([targetWidth, finalHeight]);

      page.drawImage(embeddedImage, {
        x: 0,
        y: finalHeight - scaledHeight,
        width: targetWidth,
        height: scaledHeight,
      });

      const pdfBytes = await pdfDoc.save();
      binaryData = Buffer.from(pdfBytes);
    } else {
      const base64Data = pdfBase64.replace(/^data:.*;base64,/, "");
      binaryData = Buffer.from(base64Data, "base64");
    }

    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(binaryData);
    } catch (err) {
      console.error("PDF load failed:", err);
      return res.status(400).json({
        message: "Invalid PDF format.",
        error: err.message,
      });
    }

    const pages = pdfDoc.getPages();
    const targetWidth = 226.77; // 80mm
    pages.forEach((page) => {
      const { height } = page.getSize();
      const adjustedHeight = Math.max(height, 500);
      page.setSize(targetWidth, adjustedHeight);
    });

    const updatedPdfBytes = await pdfDoc.save();
    const tempFilePath = path.join(os.tmpdir(), `temp_${Date.now()}.pdf`);
    fs.writeFileSync(tempFilePath, updatedPdfBytes);

    console.log("Sending to printers:", printernamefromfrontend);

    await Promise.all(
      printernamefromfrontend.map((printer) =>
        pdfToPrinter
          .print(tempFilePath, { printer })
          .then(() => console.log(`✅ Printed to ${printer}`))
          .catch((err) =>
            console.error(`❌ Failed to print to ${printer}:`, err)
          )
      )
    );

    setTimeout(() => {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }, 10000);

    res.status(200).json({ message: "PDF printed successfully!" });
  } catch (error) {
    console.error("Print error:", error);
    res.status(500).json({
      message: "Printing failed!",
      error: error.message,
    });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🖨️  Printer server running at http://localhost:${PORT}`);
});
