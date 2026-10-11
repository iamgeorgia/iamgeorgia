| Endpoint | Newman coverage |
|---|---|
| POST /api/auth/login | 35 req, 0 failed |
| POST /api/auth/logout | 7 req, 0 failed |
| GET /api/auth/me | 3 req, 0 failed |
| GET /api/auth/activation/:token | — |
| POST /api/auth/activation/:token | — |
| POST /api/auth/password/forgot | 2 req, 0 failed |
| POST /api/auth/password/change | 2 req, 0 failed |
| POST /api/auth/password/reset/:token | — |
| GET /api/invitations/:token | — |
| POST /api/invitations/:token/accept | — |
| GET /api/destinations/ | — |
| GET /api/destinations/:slug | 1 req, 0 failed |
| GET /api/search/tours/ | — |
| GET /api/search/tours/:slug | — |
| POST /api/search/tours/offers/quote | 2 req, 0 failed |
| GET /api/search/ | — |
| GET /api/search/hotels/:slug | 1 req, 0 failed |
| POST /api/search/offers/quote | 4 req, 0 failed |
| POST /api/tours/bookings/holds | 1 req, 0 failed |
| DELETE /api/tours/bookings/holds/:token | 1 req, 0 failed |
| POST /api/tours/bookings/ | — |
| GET /api/tours/bookings/:reference | 2 req, 0 failed |
| GET /api/tours/bookings/:reference/cancellation-quote | 1 req, 0 failed |
| PATCH /api/tours/bookings/:reference | 1 req, 0 failed |
| POST /api/tours/bookings/:reference/cancel | 2 req, 0 failed |
| GET /api/tours/ | — |
| GET /api/tours/:slug | — |
| GET /api/services/ | — |
| GET /api/services/:slug | 2 req, 0 failed |
| GET /api/packages/ | — |
| POST /api/packages/quotes/revalidate | 2 req, 0 failed |
| GET /api/packages/:slug | 1 req, 0 failed |
| GET /api/packages/:slug/quote | 3 req, 0 failed |
| GET /api/recommendations/ | — |
| POST /api/orders/holds | 2 req, 0 failed |
| DELETE /api/orders/holds | 2 req, 0 failed |
| POST /api/orders/ | — |
| GET /api/orders/:reference | 1 req, 0 failed |
| GET /api/orders/:reference/cancellation-quote | 1 req, 0 failed |
| PATCH /api/orders/:reference | 2 req, 0 failed |
| POST /api/orders/:reference/cancel | 1 req, 0 failed |
| POST /api/orders/:reference/items/:slotIndex/cancel | — |
| POST /api/service-bookings/ | — |
| GET /api/service-bookings/ | — |
| GET /api/service-bookings/:reference | 1 req, 0 failed |
| GET /api/service-bookings/:reference/cancellation-quote | 1 req, 0 failed |
| POST /api/service-bookings/:reference/cancel | 2 req, 0 failed |
| GET /api/hotels/ | — |
| GET /api/hotels/:slug | 1 req, 0 failed |
| POST /api/bookings/holds | 1 req, 0 failed |
| DELETE /api/bookings/holds/:token | 1 req, 0 failed |
| POST /api/bookings/ | — |
| GET /api/bookings/:reference | 3 req, 0 failed |
| GET /api/bookings/:reference/cancellation-quote | 1 req, 0 failed |
| PATCH /api/bookings/:reference | 2 req, 0 failed |
| POST /api/bookings/:reference/cancel | 3 req, 0 failed |
| POST /api/transfers/bookings/ | — |
| GET /api/transfers/bookings/:reference | 1 req, 0 failed |
| GET /api/transfers/bookings/:reference/cancellation-quote | 1 req, 1 failed |
| PATCH /api/transfers/bookings/:reference | 1 req, 0 failed |
| POST /api/transfers/bookings/:reference/cancel | 1 req, 0 failed |
| GET /api/transfers/points | 1 req, 0 failed |
| GET /api/transfers/routes | 2 req, 0 failed |
| GET /api/transfers/routes/:slug | 2 req, 0 failed |
| GET /api/transfers/vehicles | 2 req, 0 failed |
| GET /api/transfers/vehicles/:slug | 2 req, 0 failed |
| GET /api/transfers/extras | 1 req, 0 failed |
| GET /api/transfers/quotes | 6 req, 0 failed |
| POST /api/transfers/quotes/revalidate | 1 req, 0 failed |
| POST /api/transfers/ratings | 2 req, 0 failed |
| GET /api/amenities/ | — |
| GET /api/admin/badges/ | — |
| GET /api/admin/users/ | — |
| POST /api/admin/users/ | — |
| GET /api/admin/users/:id | 1 req, 0 failed |
| GET /api/admin/users/:id/grantable | — |
| PATCH /api/admin/users/:id/role | 1 req, 0 failed |
| PUT /api/admin/users/:id/roles | — |
| POST /api/admin/users/:id/overrides | — |
| DELETE /api/admin/users/:id/overrides/:capability | — |
| POST /api/admin/users/:id/deactivate | 1 req, 0 failed |
| POST /api/admin/users/:id/reactivate | — |
| POST /api/admin/users/:id/sessions/revoke | — |
| POST /api/admin/users/:id/activation/resend | 1 req, 0 failed |
| DELETE /api/admin/users/:id | 2 req, 0 failed |
| GET /api/admin/roles/capabilities | — |
| GET /api/admin/roles/ | — |
| POST /api/admin/roles/ | — |
| GET /api/admin/roles/:key | — |
| PATCH /api/admin/roles/:key | — |
| DELETE /api/admin/roles/:key | — |
| GET /api/admin/approvals/ | — |
| POST /api/admin/approvals/ | — |
| GET /api/admin/approvals/:id | — |
| POST /api/admin/approvals/:id/approve | — |
| POST /api/admin/approvals/:id/reject | — |
| POST /api/admin/approvals/:id/cancel | — |
| GET /api/admin/audit/ | — |
| GET /api/admin/finance/payables | 3 req, 0 failed |
| GET /api/admin/finance/payables/:id | — |
| PATCH /api/admin/finance/payables/:id | — |
| POST /api/admin/finance/payables/:id/instalments/:sequence/pay | — |
| GET /api/admin/finance/receivables | 1 req, 0 failed |
| GET /api/admin/finance/receivables/:id | — |
| PATCH /api/admin/finance/receivables/:id | 1 req, 1 failed |
| GET /api/admin/finance/payments | 1 req, 0 failed |
| GET /api/admin/finance/payments/:id | — |
| POST /api/admin/finance/payments | 3 req, 1 failed |
| POST /api/admin/finance/payments/:id/allocations | — |
| GET /api/admin/finance/due | 3 req, 0 failed |
| GET /api/admin/finance/penalties | — |
| GET /api/admin/finance/partners/:id/credit | — |
| PATCH /api/admin/finance/partners/:id/credit | — |
| GET /api/admin/finance/reports/commission | — |
| GET /api/admin/finance/reports/summary | 1 req, 0 failed |
| GET /api/admin/finance/reports/margin | 2 req, 0 failed |
| GET /api/admin/finance/reports/ageing | 1 req, 0 failed |
| GET /api/admin/finance/terms/:kind/:id | — |
| PUT /api/admin/finance/terms/:kind/:id | — |
| GET /api/admin/finance/partners/:id/terms | — |
| PATCH /api/admin/finance/partners/:id/terms | — |
| GET /api/admin/notifications/ | — |
| GET /api/admin/notifications/unread-count | 2 req, 0 failed |
| POST /api/admin/notifications/read-all | 1 req, 0 failed |
| POST /api/admin/notifications/:id/read | 2 req, 0 failed |
| GET /api/admin/outbox/failed | 1 req, 0 failed |
| POST /api/admin/outbox/:id/retry | — |
| GET /api/admin/partners/ | — |
| POST /api/admin/partners/ | — |
| GET /api/admin/partners/:id | 2 req, 0 failed |
| PATCH /api/admin/partners/:id | 2 req, 0 failed |
| DELETE /api/admin/partners/:id | 3 req, 0 failed |
| POST /api/admin/partners/:id/approve | 3 req, 2 failed |
| POST /api/admin/partners/:id/reject | 1 req, 1 failed |
| POST /api/admin/partners/:id/suspend | 2 req, 1 failed |
| POST /api/admin/partners/:id/reactivate | 1 req, 1 failed |
| POST /api/admin/partners/:id/block | — |
| POST /api/admin/partners/:id/unblock | — |
| POST /api/admin/partners/:id/terminate | — |
| POST /api/admin/partners/:id/contract | — |
| GET /api/admin/partners/:id/contract | — |
| PUT /api/admin/partners/:id/contract-requirement | — |
| GET /api/admin/partners/:id/product-access | — |
| PUT /api/admin/partners/:id/product-access | — |
| GET /api/admin/partners/:id/financial | 2 req, 0 failed |
| PUT /api/admin/partners/:id/financial | 2 req, 0 failed |
| GET /api/admin/partners/:id/invitations | 2 req, 0 failed |
| POST /api/admin/partners/:id/invitations | 2 req, 1 failed |
| GET /api/admin/partners/:id/audit | 1 req, 1 failed |
| GET /api/admin/destinations/ | — |
| GET /api/admin/destinations/tree | 1 req, 0 failed |
| GET /api/admin/destinations/:id | 3 req, 0 failed |
| POST /api/admin/destinations/ | — |
| PATCH /api/admin/destinations/:id | 2 req, 0 failed |
| DELETE /api/admin/destinations/:id | 2 req, 0 failed |
| PUT /api/admin/destinations/:id/translations/:locale | — |
| GET /api/admin/hotels/:hotelId/rate-plans | 2 req, 0 failed |
| GET /api/admin/hotels/ | — |
| GET /api/admin/hotels/:id | 6 req, 0 failed |
| POST /api/admin/hotels/ | — |
| PATCH /api/admin/hotels/:id | 2 req, 0 failed |
| PUT /api/admin/hotels/:id/amenities | 2 req, 0 failed |
| DELETE /api/admin/hotels/:id | 2 req, 0 failed |
| POST /api/admin/hotels/:id/publish | 3 req, 0 failed |
| POST /api/admin/hotels/:id/unpublish | 1 req, 0 failed |
| POST /api/admin/hotels/:id/archive | 2 req, 0 failed |
| POST /api/admin/hotels/:id/images | 1 req, 0 failed |
| PATCH /api/admin/hotels/:id/images/:imageId | 1 req, 0 failed |
| DELETE /api/admin/hotels/:id/images/:imageId | 1 req, 0 failed |
| PUT /api/admin/hotels/:id/images/order | 2 req, 0 failed |
| PUT /api/admin/hotels/:id/translations/:locale | — |
| GET /api/admin/amenities/ | — |
| GET /api/admin/amenities/:id | 1 req, 0 failed |
| POST /api/admin/amenities/ | — |
| PATCH /api/admin/amenities/:id | 3 req, 0 failed |
| PUT /api/admin/amenities/:id/translations/:locale | — |
| GET /api/admin/media/ | — |
| POST /api/admin/media/ | — |
| GET /api/admin/media/:id | 1 req, 0 failed |
| GET /api/admin/media/:id/url | 1 req, 0 failed |
| DELETE /api/admin/media/:id | — |
| GET /api/admin/bookings/ | — |
| GET /api/admin/bookings/summary | 1 req, 0 failed |
| GET /api/admin/bookings/:reference | 1 req, 0 failed |
| POST /api/admin/bookings/:reference/requests/:requestId | — |
| POST /api/admin/bookings/:reference/cancel | 1 req, 0 failed |
| GET /api/admin/pricing-rules/ | — |
| GET /api/admin/pricing-rules/explain | 2 req, 0 failed |
| POST /api/admin/pricing-rules/ | — |
| PUT /api/admin/pricing-rules/:id | 1 req, 0 failed |
| DELETE /api/admin/pricing-rules/:id | 2 req, 0 failed |
| GET /api/admin/transfers/bookings/ | — |
| GET /api/admin/transfers/bookings/summary | 1 req, 0 failed |
| GET /api/admin/transfers/bookings/:reference | 1 req, 0 failed |
| POST /api/admin/transfers/bookings/:reference/cancel | 1 req, 0 failed |
| GET /api/admin/transfers/fleet/ | — |
| POST /api/admin/transfers/fleet/ | — |
| GET /api/admin/transfers/fleet/:id | 3 req, 0 failed |
| PATCH /api/admin/transfers/fleet/:id | 2 req, 0 failed |
| POST /api/admin/transfers/fleet/:id/archive | 1 req, 0 failed |
| POST /api/admin/transfers/fleet/:id/activate | 1 req, 0 failed |
| DELETE /api/admin/transfers/fleet/:id | 2 req, 0 failed |
| GET /api/admin/transfers/fleet/:id/images | 1 req, 0 failed |
| POST /api/admin/transfers/fleet/:id/images | 2 req, 0 failed |
| PUT /api/admin/transfers/fleet/:id/images/order | 1 req, 0 failed |
| PATCH /api/admin/transfers/fleet/:id/images/:imageId | 1 req, 0 failed |
| DELETE /api/admin/transfers/fleet/:id/images/:imageId | 1 req, 0 failed |
| GET /api/admin/transfers/fleet/:id/documents | 1 req, 0 failed |
| POST /api/admin/transfers/fleet/:id/documents | 2 req, 0 failed |
| GET /api/admin/transfers/fleet/:id/documents/:documentId/url | — |
| DELETE /api/admin/transfers/fleet/:id/documents/:documentId | — |
| GET /api/admin/transfers/drivers/ | — |
| POST /api/admin/transfers/drivers/ | — |
| GET /api/admin/transfers/drivers/:id | 2 req, 0 failed |
| PATCH /api/admin/transfers/drivers/:id | 3 req, 0 failed |
| POST /api/admin/transfers/drivers/:id/verify | 2 req, 0 failed |
| POST /api/admin/transfers/drivers/:id/deactivate | 2 req, 0 failed |
| POST /api/admin/transfers/drivers/:id/activate | 1 req, 0 failed |
| DELETE /api/admin/transfers/drivers/:id | 1 req, 0 failed |
| POST /api/admin/transfers/drivers/:id/account | 2 req, 0 failed |
| POST /api/admin/transfers/drivers/:id/account/resend | 1 req, 0 failed |
| PUT /api/admin/transfers/drivers/:id/vehicles | 2 req, 0 failed |
| GET /api/admin/transfers/drivers/:id/documents | 1 req, 0 failed |
| POST /api/admin/transfers/drivers/:id/documents | 1 req, 0 failed |
| GET /api/admin/transfers/drivers/:id/documents/:documentId/url | — |
| DELETE /api/admin/transfers/drivers/:id/documents/:documentId | — |
| GET /api/admin/transfers/dispatch/legs | 5 req, 0 failed |
| GET /api/admin/transfers/dispatch/legs/:legId | 1 req, 0 failed |
| GET /api/admin/transfers/dispatch/legs/:legId/candidates | 1 req, 0 failed |
| POST /api/admin/transfers/dispatch/legs/:legId/assign | 3 req, 0 failed |
| POST /api/admin/transfers/dispatch/legs/:legId/unassign | 3 req, 0 failed |
| POST /api/admin/transfers/dispatch/legs/:legId/status | 3 req, 0 failed |
| POST /api/admin/transfers/dispatch/legs/:legId/cancel | 1 req, 0 failed |
| GET /api/admin/transfers/dispatch/assignments | 2 req, 0 failed |
| GET /api/admin/transfers/dispatch/assignments/:id | 1 req, 0 failed |
| GET /api/admin/transfers/dispatch/schedule | 2 req, 0 failed |
| GET /api/admin/transfers/dispatch/blocks | 1 req, 0 failed |
| POST /api/admin/transfers/dispatch/blocks | 2 req, 0 failed |
| DELETE /api/admin/transfers/dispatch/blocks/:id | 2 req, 0 failed |
| GET /api/admin/transfers/dispatch/ratings | 2 req, 0 failed |
| POST /api/admin/transfers/dispatch/legs/:legId/rating | 2 req, 0 failed |
| POST /api/admin/transfers/dispatch/ratings/:id/publish | — |
| POST /api/admin/transfers/dispatch/ratings/:id/reject | — |
| GET /api/admin/transfers/points | 1 req, 0 failed |
| POST /api/admin/transfers/points | 4 req, 0 failed |
| GET /api/admin/transfers/points/:id | 2 req, 0 failed |
| PATCH /api/admin/transfers/points/:id | 2 req, 0 failed |
| DELETE /api/admin/transfers/points/:id | 3 req, 0 failed |
| PUT /api/admin/transfers/points/:id/translations/:locale | — |
| GET /api/admin/transfers/providers | 2 req, 0 failed |
| GET /api/admin/transfers/vehicles | 2 req, 0 failed |
| POST /api/admin/transfers/vehicles | 1 req, 0 failed |
| GET /api/admin/transfers/vehicles/:id | 1 req, 0 failed |
| PATCH /api/admin/transfers/vehicles/:id | 2 req, 0 failed |
| POST /api/admin/transfers/vehicles/:id/archive | 1 req, 0 failed |
| PUT /api/admin/transfers/vehicles/:id/translations/:locale | — |
| PUT /api/admin/transfers/routes/prices | 4 req, 0 failed |
| GET /api/admin/transfers/routes | 1 req, 0 failed |
| POST /api/admin/transfers/routes | 2 req, 0 failed |
| GET /api/admin/transfers/routes/:id | 2 req, 0 failed |
| PATCH /api/admin/transfers/routes/:id | 1 req, 0 failed |
| PUT /api/admin/transfers/routes/:id/prices | 2 req, 0 failed |
| PUT /api/admin/transfers/routes/:id/stops | 1 req, 0 failed |
| POST /api/admin/transfers/routes/:id/publish | 2 req, 0 failed |
| POST /api/admin/transfers/routes/:id/unpublish | 1 req, 0 failed |
| POST /api/admin/transfers/routes/:id/archive | 1 req, 0 failed |
| PUT /api/admin/transfers/routes/:id/translations/:locale | — |
| GET /api/admin/transfers/extras | 1 req, 0 failed |
| POST /api/admin/transfers/extras | 1 req, 0 failed |
| PUT /api/admin/transfers/extras/:id | — |
| DELETE /api/admin/transfers/extras/:id | — |
| GET /api/admin/transfers/blackouts | 1 req, 0 failed |
| POST /api/admin/transfers/blackouts | 3 req, 0 failed |
| DELETE /api/admin/transfers/blackouts/:id | 2 req, 0 failed |
| GET /api/admin/tours/bookings/ | — |
| GET /api/admin/tours/bookings/:reference | 1 req, 0 failed |
| POST /api/admin/tours/bookings/:reference/confirm | — |
| POST /api/admin/tours/bookings/:reference/decline | 2 req, 0 failed |
| POST /api/admin/tours/bookings/:reference/cancel | 1 req, 0 failed |
| GET /api/admin/tours/policies/cancellation | 2 req, 0 failed |
| GET /api/admin/tours/ | — |
| POST /api/admin/tours/ | — |
| GET /api/admin/tours/:tourId | 2 req, 0 failed |
| PATCH /api/admin/tours/:tourId | 3 req, 0 failed |
| POST /api/admin/tours/:tourId/publish | 3 req, 0 failed |
| POST /api/admin/tours/:tourId/unpublish | 2 req, 0 failed |
| POST /api/admin/tours/:tourId/archive | 2 req, 0 failed |
| DELETE /api/admin/tours/:tourId | 1 req, 0 failed |
| PUT /api/admin/tours/:tourId/kosher | 1 req, 0 failed |
| GET /api/admin/tours/:tourId/translations | 1 req, 0 failed |
| PUT /api/admin/tours/:tourId/translations/:locale | — |
| POST /api/admin/tours/:tourId/images | 1 req, 0 failed |
| PUT /api/admin/tours/:tourId/images/order | 1 req, 0 failed |
| PATCH /api/admin/tours/:tourId/images/:imageId | 1 req, 0 failed |
| DELETE /api/admin/tours/:tourId/images/:imageId | 1 req, 0 failed |
| GET /api/admin/tours/:tourId/options | 1 req, 0 failed |
| POST /api/admin/tours/:tourId/options | 2 req, 0 failed |
| GET /api/admin/tours/:tourId/options/:optionId | 1 req, 0 failed |
| PATCH /api/admin/tours/:tourId/options/:optionId | 1 req, 0 failed |
| POST /api/admin/tours/:tourId/options/:optionId/archive | 2 req, 0 failed |
| POST /api/admin/tours/:tourId/options/:optionId/seasons | 2 req, 0 failed |
| PUT /api/admin/tours/:tourId/options/:optionId/seasons/:seasonId | 1 req, 0 failed |
| DELETE /api/admin/tours/:tourId/options/:optionId/seasons/:seasonId | 2 req, 0 failed |
| GET /api/admin/tours/:tourId/options/:optionId/inventory/calendar | 1 req, 0 failed |
| PUT /api/admin/tours/:tourId/options/:optionId/inventory | 2 req, 0 failed |
| GET /api/admin/services/bookings/ | — |
| GET /api/admin/services/bookings/:reference | 2 req, 0 failed |
| GET /api/admin/services/bookings/:reference/cancellation-quote | 1 req, 0 failed |
| POST /api/admin/services/bookings/:reference/confirm | 2 req, 0 failed |
| POST /api/admin/services/bookings/:reference/decline | 3 req, 0 failed |
| POST /api/admin/services/bookings/:reference/cancel | 2 req, 0 failed |
| GET /api/admin/services/ | — |
| POST /api/admin/services/ | — |
| GET /api/admin/services/:serviceId | 2 req, 0 failed |
| PATCH /api/admin/services/:serviceId | 4 req, 0 failed |
| POST /api/admin/services/:serviceId/publish | 3 req, 0 failed |
| POST /api/admin/services/:serviceId/unpublish | 1 req, 0 failed |
| POST /api/admin/services/:serviceId/archive | 1 req, 0 failed |
| DELETE /api/admin/services/:serviceId | 2 req, 0 failed |
| GET /api/admin/services/:serviceId/translations | 2 req, 0 failed |
| PUT /api/admin/services/:serviceId/translations/:locale | — |
| GET /api/admin/packages/ | — |
| POST /api/admin/packages/ | — |
| GET /api/admin/packages/:packageId | 2 req, 0 failed |
| PATCH /api/admin/packages/:packageId | 4 req, 0 failed |
| POST /api/admin/packages/:packageId/publish | 3 req, 0 failed |
| POST /api/admin/packages/:packageId/unpublish | 1 req, 0 failed |
| POST /api/admin/packages/:packageId/archive | 1 req, 0 failed |
| DELETE /api/admin/packages/:packageId | 1 req, 0 failed |
| GET /api/admin/packages/:packageId/preview-quote | 2 req, 0 failed |
| PUT /api/admin/packages/:packageId/kosher | 3 req, 0 failed |
| DELETE /api/admin/packages/:packageId/kosher | 1 req, 0 failed |
| PUT /api/admin/packages/:packageId/kosher/override | 3 req, 0 failed |
| GET /api/admin/packages/:packageId/translations | 2 req, 0 failed |
| PUT /api/admin/packages/:packageId/translations/:locale | — |
| POST /api/admin/packages/:packageId/images | 2 req, 0 failed |
| PUT /api/admin/packages/:packageId/images/order | 2 req, 0 failed |
| PATCH /api/admin/packages/:packageId/images/:imageId | 2 req, 0 failed |
| DELETE /api/admin/packages/:packageId/images/:imageId | 1 req, 0 failed |
| GET /api/admin/orders/ | — |
| GET /api/admin/orders/:reference | 2 req, 0 failed |
| GET /api/admin/orders/:reference/cancellation-quote | 1 req, 0 failed |
| POST /api/admin/orders/:reference/cancel | 2 req, 0 failed |
| POST /api/admin/orders/:reference/items/:slotIndex/confirm | — |
| POST /api/admin/orders/:reference/items/:slotIndex/decline | — |
| POST /api/admin/orders/:reference/items/:slotIndex/cancel | — |
| GET /api/partner/tours/bookings/ | — |
| GET /api/partner/orders/ | — |
| GET /api/partner/hotels/ | — |
| GET /api/partner/hotels/:hotelId | 1 req, 0 failed |
| GET /api/partner/hotels/:hotelId/room-types | — |
| GET /api/partner/hotels/:hotelId/room-types/:roomTypeId/inventory/calendar | — |
| PUT /api/partner/hotels/:hotelId/room-types/:roomTypeId/inventory | — |
| PUT /api/partner/hotels/:hotelId/room-types/:roomTypeId/rate-plans/:ratePlanId/rates | — |
| GET /api/partner/hotels/:hotelId/bookings | — |
| GET /api/partner/bookings/ | — |
| GET /api/partner/transfers/bookings/ | — |
| GET /api/partner/transfers/bookings/:reference | 1 req, 0 failed |
| POST /api/partner/transfers/bookings/:reference/legs/:legIndex/rating | — |
| POST /api/partner/drivers/available | 2 req, 0 failed |
| GET /api/partner/drivers/:id | — |
| GET /api/partner/team/ | — |
| POST /api/partner/team/ | — |
| GET /api/partner/team/grantable | — |
| GET /api/partner/team/:id | 1 req, 0 failed |
| PATCH /api/partner/team/:id/role | — |
| PUT /api/partner/team/:id/roles | — |
| PATCH /api/partner/team/:id/primary-contact | — |
| POST /api/partner/team/:id/deactivate | — |
| POST /api/partner/team/:id/reactivate | — |
| POST /api/partner/team/:id/sessions/revoke | — |
| POST /api/partner/team/:id/activation/resend | — |
| DELETE /api/partner/team/:id | — |
| GET /api/partner/finance/statement | 1 req, 0 failed |
| GET /api/partner/finance/payables | — |
| GET /api/partner/finance/credit | — |
| GET /api/partner/finance/commission | — |
| GET /api/partner/notifications/ | — |
| GET /api/partner/notifications/unread-count | 1 req, 0 failed |
| POST /api/partner/notifications/read-all | — |
| POST /api/partner/notifications/:id/read | — |
| GET /api/partner/me | 2 req, 0 failed |
| GET /api/partner/contract | — |
| GET /api/partner/terms | — |
| POST /api/partner/terms/accept | — |
| PATCH /api/partner/account | 1 req, 0 failed |
| GET /api/partner/dashboard | 1 req, 1 failed |
| PATCH /api/partner/profile | 1 req, 1 failed |
| GET /api/partner/financial | 2 req, 1 failed |
| PUT /api/partner/financial | 2 req, 0 failed |
| GET /api/driver/me | 1 req, 0 failed |
| PATCH /api/driver/me | 2 req, 0 failed |
| GET /api/driver/me/ratings | 1 req, 0 failed |
| GET /api/driver/vehicles | 1 req, 0 failed |
| GET /api/driver/assignments | 3 req, 0 failed |
| GET /api/driver/assignments/:id | 1 req, 0 failed |
| POST /api/driver/assignments/:id/accept | 2 req, 0 failed |
| POST /api/driver/assignments/:id/decline | 1 req, 0 failed |
| POST /api/driver/assignments/:id/status | 3 req, 0 failed |
| GET /api/driver/notifications | 2 req, 0 failed |
| POST /api/driver/notifications/read-all | 1 req, 0 failed |
| POST /api/driver/notifications/:id/read | 1 req, 0 failed |