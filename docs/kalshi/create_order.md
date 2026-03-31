# Create Order

> Source: https://docs.kalshi.com/api-reference/orders/create-order.md
> POST /portfolio/orders

## Request

```json
{
  "ticker": "KXBTCD-25AUG0517-T114999.99",
  "side": "yes",
  "action": "buy",
  "count": 10,
  "yes_price": 60,
  "no_price": 40,
  "time_in_force": "good_till_canceled"
}
```

**Required:** `ticker`, `side` (yes|no), `action` (buy|sell)
**Price:** Provide `yes_price` OR `no_price` (1-99 cents)
**Quantity:** `count` (integer) or `count_fp` (fixed-point string)
**time_in_force:** `fill_or_kill` | `good_till_canceled` | `immediate_or_cancel`

## Response

Returns `order` object with `order_id`, `queue_position` (deprecated - use GET queue_position endpoint), `status`, etc.
