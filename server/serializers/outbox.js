/** An outbox event as the dead-letter screen shows it. The payload is ids, never a person's details. */
export const toOutboxEvent = (event) => ({
    id: event.id,
    topic: event.topic,
    payload: event.payload ?? {},
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    attempts: event.attempts,
    lastError: event.lastError ?? null,
    nextAttemptAt: event.nextAttemptAt,
    processedAt: event.processedAt ?? null,
    createdAt: event.createdAt
});
