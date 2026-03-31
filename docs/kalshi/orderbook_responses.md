# Orderbook Responses

> Source: https://docs.kalshi.com/getting_started/orderbook_responses.md
> Understanding Kalshi orderbook structure and binary prediction market mechanics

## Getting Orderbook Data

The Get Market Orderbook endpoint returns the current state of bids for a specific market.

### Request Format

```
GET /markets/{ticker}/orderbook
```

No authentication is required for this endpoint.

### Example Request

```javascript
const marketTicker = "KXHIGHNY-24JAN01-T60";
const url = `https://api.elections.kalshi.com/trade-api/v2/markets/${marketTicker}/orderbook`;

fetch(url)
  .then(response => response.json())
  .then(data => console.log(data));
```

## Response Structure

The orderbook response contains two arrays of bids - one for YES positions and one for NO positions. Each bid is represented as a two-element array: `[price, quantity]`.

### Example Response

```json
{
  "orderbook": {
    "yes": [
      [1, 200],    [15, 100],   [20, 50],    [25, 20],    [30, 11],
      [31, 10],    [32, 10],    [33, 11],    [34, 9],     [35, 11],
      [41, 10],    [42, 13]
    ],
    "no": [
      [1, 100],    [16, 3],     [25, 50],    [28, 19],    [36, 5],
      [37, 50],    [38, 300],   [44, 29],    [45, 20],    [56, 17]
    ]
  }
}
```

### Understanding the Arrays

- **First element**: Price in cents (1-99)
- **Second element**: Number of contracts available at that price
- Arrays are sorted by price in **ascending order**
- The **highest** bid (best bid) is the **last** element in each array

## Why Only Bids?

Kalshi's orderbook only returns bids, not asks. In binary prediction markets:
- A **YES BID** at price X is equivalent to a **NO ASK** at price (100 - X)
- A **NO BID** at price Y is equivalent to a **YES ASK** at price (100 - Y)

## Calculating Spreads

- Best YES bid: Highest price in the `yes` array
- Best YES ask: 100 - (Highest price in the `no` array)
- Spread = Best YES ask - Best YES bid
