/**
 * Removes the finance rows that hang off bookings a dev script is about to
 * delete.
 *
 * Payables and receivables hold their booking with Restrict on purpose — in
 * production a booking with money attached must not disappear — so any script
 * that clears demo bookings has to clear their finance rows first: payments
 * allocated to them, then the payables (instalments cascade) and receivables.
 * Each argument is a Prisma `where` on the matching booking relation, or null.
 */
export const deleteFinanceForBookings = async (prisma, { hotelBooking = null, transferBooking = null, tourBooking = null, serviceBooking = null, order = null }) => {
    const relations = Object.entries({ hotelBooking, transferBooking, tourBooking, serviceBooking, order }).filter(([, where]) => where);

    if (relations.length === 0) {
        return { payables: 0, receivables: 0 };
    }

    const receivableWhere = { OR: relations.map(([relation, where]) => ({ [relation]: where })) };
    const payableWhere = { OR: relations.filter(([relation]) => relation !== 'order').map(([relation, where]) => ({ [relation]: where })) };

    const [receivables, payables] = await Promise.all([
        prisma.receivable.findMany({ where: receivableWhere, select: { id: true } }),
        payableWhere.OR.length > 0 ? prisma.supplierPayable.findMany({ where: payableWhere, select: { id: true } }) : []
    ]);

    const receivableIds = receivables.map(({ id }) => id);
    const payableIds = payables.map(({ id }) => id);

    const payments = await prisma.paymentRecord.findMany({
        where: {
            allocations: {
                some: { OR: [{ receivableId: { in: receivableIds } }, { payableInstalment: { payableId: { in: payableIds } } }] }
            }
        },
        select: { id: true }
    });

    await prisma.paymentRecord.deleteMany({ where: { id: { in: payments.map(({ id }) => id) } } });
    await prisma.supplierPayable.deleteMany({ where: { id: { in: payableIds } } });

    // Invoices hold their receivable with Restrict (a document must not lose
    // what it was issued for), and a correction holds the invoice it corrects:
    // derived documents go first, then the rest, then the receivables.
    const invoices = await prisma.invoice.findMany({ where: { receivableId: { in: receivableIds } }, select: { id: true } });
    const invoiceIds = invoices.map(({ id }) => id);

    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds }, fromInvoiceId: { not: null } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.receivable.deleteMany({ where: { id: { in: receivableIds } } });

    return { payables: payableIds.length, receivables: receivableIds.length, invoices: invoiceIds.length };
};
