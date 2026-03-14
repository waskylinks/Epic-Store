import PDFDocument from 'pdfkit';

/**
 * Generate professional invoice PDF with modern UI
 * @param {Object} order - Order document from database
 * @param {Object} companyInfo - Company information
 * @returns {Promise<Buffer>} PDF buffer
 */
export const generateInvoicePDF = async (order, companyInfo = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        bufferPages: true
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const colors = {
        primary:        '#ff3c3c',
        black:          '#1a1a1a',
        darkGrey:       '#333333',
        lightGrey:      '#666666',
        veryLightGrey:  '#f8f8f8',
        border:         '#e0e0e0',
        white:          '#ffffff',
        discountGreen:  '#059669',
      };

      const formatAmount = (amount) =>
        `$${Number(amount).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`;

      const formatDate = (date) =>
        new Date(date).toLocaleDateString('en-US', {
          year:  'numeric',
          month: 'long',
          day:   'numeric'
        });

      const drawLine = (y, color = colors.border, lineWidth = 0.5) => {
        doc.strokeColor(color).lineWidth(lineWidth)
           .moveTo(50, y).lineTo(545, y).stroke();
      };

      const drawBox = (x, y, width, height, fillColor, borderColor = null) => {
        doc.rect(x, y, width, height);
        if (fillColor)   doc.fillColor(fillColor).fill();
        if (borderColor) doc.strokeColor(borderColor).stroke();
      };

      // ── HEADER ─────────────────────────────────────────────────────────────
      let yPos = 50;

      doc.fontSize(24).fillColor(colors.black).font('Helvetica-Bold')
         .text('EPIC', 50, yPos, { continued: true })
         .fillColor(colors.primary).text('STORE');

      doc.fontSize(32).fillColor(colors.primary).font('Helvetica-Bold')
         .text('INVOICE', 400, yPos, { align: 'right', width: 145 });

      yPos += 40;

      doc.fontSize(9).fillColor(colors.lightGrey).font('Helvetica')
         .text(companyInfo.name    || 'EPIC STORE Inc.',          50, yPos)
         .text(companyInfo.address || '123 Commerce Street',      50, yPos + 12)
         .text(companyInfo.city    || 'New York, NY 10001',       50, yPos + 24)
         .text(companyInfo.country || 'United States',            50, yPos + 36)
         .text(`Tax ID: ${companyInfo.taxId || 'XX-XXXXXXX'}`,   50, yPos + 48);

      doc.fontSize(9).fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('Invoice Number:', 380, yPos, { align: 'left', width: 80 })
         .fillColor(colors.black).font('Helvetica')
         .text(order.invoiceInfo?.invoiceNumber || 'N/A', 465, yPos, { align: 'left' });

      yPos += 12;
      doc.fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('Invoice Date:', 380, yPos, { align: 'left', width: 80 })
         .fillColor(colors.black).font('Helvetica')
         .text(formatDate(order.invoiceInfo?.invoiceDate || order.createdAt), 465, yPos);

      yPos += 12;
      doc.fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('Order Date:', 380, yPos, { align: 'left', width: 80 })
         .fillColor(colors.black).font('Helvetica')
         .text(formatDate(order.createdAt), 465, yPos);

      yPos += 12;
      doc.fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('Order ID:', 380, yPos, { align: 'left', width: 80 })
         .fillColor(colors.black).font('Helvetica')
         .text(order._id.toString().slice(-8).toUpperCase(), 465, yPos);

      yPos += 30;
      drawLine(yPos, colors.primary, 2);
      yPos += 25;

      // ── BILL TO / SHIP TO ──────────────────────────────────────────────────
      doc.fontSize(11).fillColor(colors.primary).font('Helvetica-Bold')
         .text('BILL TO', 50, yPos);
      yPos += 18;

      doc.fontSize(10).fillColor(colors.black).font('Helvetica-Bold')
         .text(order.user?.name || 'Customer Name', 50, yPos);
      yPos += 14;

      doc.fontSize(9).fillColor(colors.lightGrey).font('Helvetica')
         .text(order.user?.email || 'customer@email.com', 50, yPos);

      doc.fontSize(11).fillColor(colors.primary).font('Helvetica-Bold')
         .text('SHIP TO', 300, yPos - 32);

      const shipY = yPos - 14;
      doc.fontSize(9).fillColor(colors.darkGrey).font('Helvetica')
         .text(order.shippingInfo?.address || '', 300, shipY, { width: 240 })
         .text(`${order.shippingInfo?.city || ''}, ${order.shippingInfo?.state || ''} ${order.shippingInfo?.pinCode || ''}`, 300, shipY + 12, { width: 240 })
         .text(order.shippingInfo?.country || '', 300, shipY + 24, { width: 240 })
         .text(`Phone: ${order.shippingInfo?.phoneNo || 'N/A'}`, 300, shipY + 36, { width: 240 });

      yPos += 70;
      drawLine(yPos, colors.border);
      yPos += 25;

      // ── ORDER ITEMS TABLE ──────────────────────────────────────────────────
      drawBox(50, yPos - 8, 495, 25, colors.veryLightGrey);

      doc.fontSize(9).fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('ITEM DESCRIPTION', 60,  yPos, { width: 200 })
         .text('QTY',              300, yPos, { width: 50,  align: 'center' })
         .text('UNIT PRICE',       370, yPos, { width: 80,  align: 'right'  })
         .text('AMOUNT',           470, yPos, { width: 65,  align: 'right'  });

      yPos += 25;
      drawLine(yPos, colors.border);
      yPos += 15;

      doc.fontSize(9).font('Helvetica');

      order.orderItems.forEach((item, index) => {
        const total = item.price * item.quantity;

        if (index % 2 === 0) drawBox(50, yPos - 5, 495, 22, colors.veryLightGrey);

        doc.fillColor(colors.black)
           .text(item.name, 60, yPos, { width: 200 })
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

      // ── TOTALS SECTION ─────────────────────────────────────────────────────
      const totalsX  = 370;
      const amountsX = 470;

      // FIX: show original (pre-discount) subtotal when a discount was applied
      // so the invoice accurately reflects gross → discount → net → tax → total.
      const discountData    = order.discounts?.codes?.[0] ?? null;
      const hasDiscount     = discountData && (discountData.amount > 0);
      const displaySubtotal = hasDiscount && discountData.originalItemPrice
        ? discountData.originalItemPrice
        : order.itemPrice || 0;

      doc.fontSize(9).fillColor(colors.darkGrey).font('Helvetica')
         .text('Subtotal:', totalsX, yPos, { width: 90, align: 'right' })
         .fillColor(colors.black)
         .text(formatAmount(displaySubtotal), amountsX, yPos, { width: 65, align: 'right' });

      yPos += 15;

      // FIX: discount row — only rendered when a discount was applied.
      // Previously absent — invoices showed the discounted itemPrice as
      // "Subtotal" with no discount line, which is incorrect accounting.
      // An invoice must show gross subtotal → discount deduction → net amount.
      if (hasDiscount) {
        const discountLabel = discountData.code
          ? `Discount (${discountData.code}):`
          : 'Discount:';

        doc.fillColor(colors.discountGreen).font('Helvetica')
           .text(discountLabel, totalsX, yPos, { width: 90, align: 'right' })
           .font('Helvetica-Bold')
           .text(`-${formatAmount(discountData.amount)}`, amountsX, yPos, { width: 65, align: 'right' })
           .font('Helvetica');

        yPos += 15;
      }

      doc.fillColor(colors.darkGrey).font('Helvetica')
         .text('Tax:', totalsX, yPos, { width: 90, align: 'right' })
         .fillColor(colors.black)
         .text(formatAmount(order.taxPrice || 0), amountsX, yPos, { width: 65, align: 'right' });

      yPos += 15;

      doc.fillColor(colors.darkGrey)
         .text('Shipping:', totalsX, yPos, { width: 90, align: 'right' })
         .fillColor(colors.black)
         .text(formatAmount(order.shippingPrice || 0), amountsX, yPos, { width: 65, align: 'right' });

      yPos += 10;
      drawLine(yPos, colors.border);
      yPos += 15;

      drawBox(totalsX - 10, yPos - 8, 175, 28, colors.veryLightGrey);

      doc.fontSize(11).fillColor(colors.primary).font('Helvetica-Bold')
         .text('TOTAL:', totalsX, yPos, { width: 90, align: 'right' })
         .fontSize(12).fillColor(colors.black)
         .text(formatAmount(order.totalPrice || 0), amountsX, yPos, { width: 65, align: 'right' });

      yPos += 35;

      if (order.amountPaid) {
        doc.fontSize(9).fillColor(colors.darkGrey).font('Helvetica')
           .text('Amount Paid:', totalsX, yPos, { width: 90, align: 'right' })
           .fillColor(colors.black)
           .text(formatAmount(order.amountPaid), amountsX, yPos, { width: 65, align: 'right' });

        yPos += 15;

        const balance = (order.totalPrice || 0) - (order.amountPaid || 0);
        doc.fillColor(colors.darkGrey)
           .text('Balance Due:', totalsX, yPos, { width: 90, align: 'right' })
           .fillColor(balance > 0 ? colors.primary : colors.black).font('Helvetica-Bold')
           .text(formatAmount(balance), amountsX, yPos, { width: 65, align: 'right' });
      }

      yPos += 40;
      drawLine(yPos, colors.primary, 1);
      yPos += 20;

      // ── PAYMENT INFORMATION ────────────────────────────────────────────────
      doc.fontSize(10).fillColor(colors.primary).font('Helvetica-Bold')
         .text('PAYMENT INFORMATION', 50, yPos);
      yPos += 18;

      doc.fontSize(9).fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('Payment Method:', 50, yPos, { continued: true })
         .fillColor(colors.black).font('Helvetica')
         .text(` ${order.paymentInfo?.method?.toUpperCase() || 'N/A'}`);

      yPos += 12;
      doc.fillColor(colors.darkGrey).font('Helvetica-Bold')
         .text('Payment Status:', 50, yPos, { continued: true })
         .fillColor(order.paymentInfo?.status === 'success' ? '#10b981' : colors.primary)
         .font('Helvetica-Bold')
         .text(` ${order.paymentInfo?.status?.toUpperCase() || 'PENDING'}`);

      if (order.paymentInfo?.reference) {
        yPos += 12;
        doc.fillColor(colors.darkGrey).font('Helvetica-Bold')
           .text('Transaction Reference:', 50, yPos, { continued: true })
           .fillColor(colors.black).font('Helvetica')
           .text(` ${order.paymentInfo.reference}`);
      }

      if (order.paymentInfo?.paidAt) {
        yPos += 12;
        doc.fillColor(colors.darkGrey).font('Helvetica-Bold')
           .text('Payment Date:', 50, yPos, { continued: true })
           .fillColor(colors.black).font('Helvetica')
           .text(` ${formatDate(order.paymentInfo.paidAt)}`);
      }

      // ── FOOTER ─────────────────────────────────────────────────────────────
      const footerY = 750;
      drawLine(footerY, colors.border);

      doc.fontSize(8).fillColor(colors.lightGrey).font('Helvetica')
         .text(
           'Thank you for your business! For questions about this invoice, please contact support@epicstore.com',
           50, footerY + 15,
           { align: 'center', width: 495 }
         );

      doc.fontSize(7)
         .text(
           `This is a computer-generated invoice. Page ${doc.bufferedPageRange().count} of ${doc.bufferedPageRange().count}`,
           50, footerY + 35,
           { align: 'center', width: 495 }
         );

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
};

export default generateInvoicePDF;