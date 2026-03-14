import PDFDocument from 'pdfkit';

/**
 * Generate modern receipt PDF
 * @param {Object} receipt - Receipt document from database
 * @returns {Promise<Buffer>} PDF buffer
 */
export const generateReceiptPDF = async (receipt) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 50, 
        size: 'A4',
        bufferPages: true
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const colors = {
        primary:        '#ff3c3c',
        black:          '#1a1a1a',
        darkGrey:       '#333333',
        lightGrey:      '#666666',
        veryLightGrey:  '#f8f8f8',
        border:         '#e0e0e0',
        success:        '#10b981',
        discountGreen:  '#059669',
      };

      const formatAmount = (amount) =>
        `$${Number(amount).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`;

      const formatDate = (date) =>
        new Date(date).toLocaleString('en-US', {
          year:   'numeric',
          month:  'long',
          day:    'numeric',
          hour:   '2-digit',
          minute: '2-digit'
        });

      const drawLine = (y, color = colors.border, lineWidth = 0.5) => {
        doc.strokeColor(color).lineWidth(lineWidth)
           .moveTo(50, y).lineTo(545, y).stroke();
      };

      const drawBox = (x, y, width, height, fillColor) => {
        doc.rect(x, y, width, height).fillColor(fillColor).fill();
      };

      // ── HEADER ─────────────────────────────────────────────────────────────
      let yPos = 50;

      doc.fontSize(28).fillColor(colors.black).font('Helvetica-Bold')
         .text('EPIC', 50, yPos, { continued: true })
         .fillColor(colors.primary).text('STORE');

      yPos += 35;

      doc.fontSize(20).fillColor(colors.primary).font('Helvetica-Bold')
         .text('PAYMENT RECEIPT', 50, yPos);

      yPos += 35;
      drawLine(yPos, colors.primary, 2);
      yPos += 25;

      // ── RECEIPT DETAILS BOX ────────────────────────────────────────────────
      drawBox(50, yPos - 10, 495, 70, colors.veryLightGrey);

      doc.fontSize(10).fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('Receipt Reference:', 60, yPos)
         .fillColor(colors.black).font('Helvetica')
         .text(receipt.reference, 180, yPos);

      yPos += 18;
      doc.fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('Date Issued:', 60, yPos)
         .fillColor(colors.black).font('Helvetica')
         .text(formatDate(receipt.createdAt), 180, yPos);

      yPos += 18;
      doc.fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('Payment Status:', 60, yPos)
         .fillColor(colors.success).font('Helvetica-Bold')
         .text('PAID', 180, yPos);

      yPos += 30;
      drawLine(yPos, colors.border);
      yPos += 25;

      // ── CUSTOMER INFORMATION ───────────────────────────────────────────────
      doc.fontSize(12).fillColor(colors.primary).font('Helvetica-Bold')
         .text('CUSTOMER INFORMATION', 50, yPos);
      yPos += 20;

      doc.fontSize(10).fillColor(colors.black).font('Helvetica-Bold')
         .text(receipt.customer?.name || 'N/A', 50, yPos);
      yPos += 15;

      doc.fontSize(9).fillColor(colors.lightGrey).font('Helvetica')
         .text(receipt.customer?.email || 'N/A', 50, yPos);
      yPos += 12;

      doc.text(`Phone: ${receipt.customer?.phoneNo || receipt.shippingInfo?.phoneNo || 'N/A'}`, 50, yPos);
      yPos += 25;

      // ── SHIPPING ADDRESS ───────────────────────────────────────────────────
      doc.fontSize(12).fillColor(colors.primary).font('Helvetica-Bold')
         .text('SHIPPING ADDRESS', 50, yPos);
      yPos += 20;

      const ship = receipt.shippingInfo;
      doc.fontSize(9).fillColor(colors.darkGrey).font('Helvetica')
         .text(ship.address || '', 50, yPos)
         .text(`${ship.city || ''}, ${ship.state || ''} ${ship.pinCode || ''}`, 50, yPos + 12)
         .text(ship.country || '', 50, yPos + 24);

      yPos += 50;
      drawLine(yPos, colors.border);
      yPos += 25;

      // ── ORDER ITEMS TABLE ──────────────────────────────────────────────────
      doc.fontSize(12).fillColor(colors.primary).font('Helvetica-Bold')
         .text('ORDER ITEMS', 50, yPos);
      yPos += 25;

      drawBox(50, yPos - 8, 495, 25, colors.veryLightGrey);

      doc.fontSize(9).fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('ITEM',       60,  yPos, { width: 230 })
         .text('QTY',        300, yPos, { width: 50,  align: 'center' })
         .text('UNIT PRICE', 370, yPos, { width: 80,  align: 'right'  })
         .text('TOTAL',      470, yPos, { width: 65,  align: 'right'  });

      yPos += 25;
      drawLine(yPos, colors.border);
      yPos += 15;

      doc.fontSize(9).font('Helvetica');

      receipt.orderItems.forEach((item, index) => {
        const total = item.price * item.quantity;

        if (index % 2 === 0) drawBox(50, yPos - 5, 495, 22, colors.veryLightGrey);

        doc.fillColor(colors.black)
           .text(item.name, 60, yPos, { width: 230 })
           .fillColor(colors.darkGrey)
           .text(item.quantity.toString(), 300, yPos, { width: 50, align: 'center' })
           .text(formatAmount(item.price),  370, yPos, { width: 80, align: 'right'  })
           .fillColor(colors.black).font('Helvetica-Bold')
           .text(formatAmount(total),        470, yPos, { width: 65, align: 'right'  })
           .font('Helvetica');

        yPos += 22;

        if (yPos > 700) { doc.addPage(); yPos = 50; }
      });

      yPos += 10;
      drawLine(yPos, colors.border);
      yPos += 25;

      // ── PAYMENT SUMMARY ────────────────────────────────────────────────────
      const totalsX   = 370;
      const amountsX  = 470;

      // FIX: show original subtotal when a discount was applied so the
      // customer can see what they paid before the discount.
      const hasDiscount = receipt.discount?.discountAmount > 0;
      const displayItemPrice = hasDiscount && receipt.discount.originalItemPrice
        ? receipt.discount.originalItemPrice
        : receipt.itemPrice ?? receipt.totalPrice;

      doc.fontSize(9).fillColor(colors.darkGrey).font('Helvetica')
         .text('Subtotal:', totalsX, yPos, { width: 90, align: 'right' })
         .fillColor(colors.black)
         .text(formatAmount(displayItemPrice), amountsX, yPos, { width: 65, align: 'right' });

      yPos += 15;

      // FIX: discount row — only rendered when a discount was applied.
      // Previously absent — the receipt showed a lower subtotal than the
      // sum of line items with no explanation, eroding customer trust.
      if (hasDiscount) {
        const discountLabel = receipt.discount.code
          ? `Discount (${receipt.discount.code}):`
          : 'Discount:';

        doc.fillColor(colors.discountGreen).font('Helvetica')
           .text(discountLabel, totalsX, yPos, { width: 90, align: 'right' })
           .font('Helvetica-Bold')
           .text(`-${formatAmount(receipt.discount.discountAmount)}`, amountsX, yPos, { width: 65, align: 'right' })
           .font('Helvetica');

        yPos += 15;
      }

      doc.fillColor(colors.darkGrey).font('Helvetica')
         .text('Tax:', totalsX, yPos, { width: 90, align: 'right' })
         .fillColor(colors.black)
         .text(formatAmount(receipt.taxPrice || 0), amountsX, yPos, { width: 65, align: 'right' });

      yPos += 15;

      doc.fillColor(colors.darkGrey)
         .text('Shipping:', totalsX, yPos, { width: 90, align: 'right' })
         .fillColor(colors.black)
         .text(formatAmount(receipt.shippingPrice || 0), amountsX, yPos, { width: 65, align: 'right' });

      yPos += 10;
      drawLine(yPos, colors.border);
      yPos += 15;

      drawBox(totalsX - 10, yPos - 8, 175, 28, colors.veryLightGrey);

      doc.fontSize(11).fillColor(colors.primary).font('Helvetica-Bold')
         .text('GRAND TOTAL:', totalsX, yPos, { width: 90, align: 'right' })
         .fontSize(12).fillColor(colors.black)
         .text(formatAmount(receipt.totalPrice), amountsX, yPos, { width: 65, align: 'right' });

      yPos += 40;
      drawLine(yPos, colors.primary, 1);
      yPos += 25;

      // ── PAYMENT METHOD ─────────────────────────────────────────────────────
      doc.fontSize(10).fillColor(colors.primary).font('Helvetica-Bold')
         .text('PAYMENT METHOD', 50, yPos);
      yPos += 18;

      doc.fontSize(9).fillColor(colors.black).font('Helvetica')
         .text(receipt.paymentGateway?.toUpperCase() || 'N/A', 50, yPos);

      // ── FOOTER ─────────────────────────────────────────────────────────────
      const footerY = 730;
      drawLine(footerY, colors.border);

      doc.fontSize(40).fillColor(colors.success).text('✓', 270, footerY + 15);

      doc.fontSize(9).fillColor(colors.lightGrey).font('Helvetica')
         .text('Thank you for shopping with EPIC STORE!', 50, footerY + 65, { align: 'center', width: 495 });

      doc.fontSize(8)
         .text('This receipt serves as official proof of payment.', 50, footerY + 80, { align: 'center', width: 495 });

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
};

export default generateReceiptPDF;