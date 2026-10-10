const person = (user) =>
    user ? { id: user.id, email: user.email, fullName: [user.firstName, user.lastName].filter(Boolean).join(' ') } : null;

/** An approval request as the inbox and its detail show it. */
export const toApproval = (request) => ({
    id: request.id,
    reference: request.reference,
    kind: request.kind,
    status: request.status,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    payload: request.payload,
    amountCents: request.amountCents ?? null,
    currency: request.currency ?? null,
    summary: request.summary,
    requestedBy: person(request.requestedBy),
    requestNote: request.requestNote ?? null,
    decidedBy: person(request.decidedBy),
    decidedAt: request.decidedAt ?? null,
    decisionNote: request.decisionNote ?? null,
    executedEntityType: request.executedEntityType ?? null,
    executedEntityId: request.executedEntityId ?? null,
    lastError: request.lastError ?? null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt
});
