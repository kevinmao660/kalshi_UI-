# Get Order Queue Position

> Source: https://docs.kalshi.com/api-reference/orders/get-order-queue-position.md
> GET /portfolio/orders/{order_id}/queue_position

Represents the number of contracts that need to be matched before this order receives a partial or full match. Queue position is determined using price-time priority.

## Response

```json
{
  "queue_position": 42,
  "queue_position_fp": "42.00"
}
```

- `queue_position`: integer, contracts ahead of this order
- Use this endpoint for accurate queue position; the `queue_position` field in Create Order response is deprecated and always returns 0.
