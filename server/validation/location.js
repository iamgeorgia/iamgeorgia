/**
 * The rules a position obeys, shared by every schema that carries one.
 *
 * Coordinates are a pair or nothing. The database says the same thing in a
 * CHECK constraint, but a 400 naming the field is a better answer than a 409
 * quoting a constraint name, and the two agreeing is the point — the
 * constraint is there for writers that never went through a route.
 *
 * On an update the two halves must be in the *same* state: both omitted
 * (leave the pin), both null (take it off the map) or both numbers (move it).
 * `{ latitude: null }` alone is refused rather than read as either, because
 * one half of a position is not a position. A place cannot be attached to
 * nothing: `place` in a body means the same body carries the coordinates it
 * describes. (An omitted `place` on an update leaves whatever was stored,
 * exactly like any other omitted field.)
 */
const stateOf = (value) => (value === undefined ? 'absent' : value === null ? 'null' : 'set');

export const withCoordinatePair = (schema) =>
    schema
        .refine((value) => stateOf(value.latitude) === stateOf(value.longitude), {
            message: 'Provide both latitude and longitude, or neither',
            path: ['latitude']
        })
        .refine((value) => value.place === undefined || value.place === null || stateOf(value.latitude) === 'set', {
            message: 'A place needs its coordinates',
            path: ['place']
        });
