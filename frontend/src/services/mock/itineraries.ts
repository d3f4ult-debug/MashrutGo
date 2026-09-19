export type Itinerary = {
  id: string
  title: string
  eta: string
  price: string
  walking: string
  transfers: number
  routeNumbers?: string
}

export function getMockItineraries(): Itinerary[] {
  return [
    { id: '15', title: 'Fastest', eta: '24 min', price: "5 000 so'm", walking: '450 m', transfers: 1, routeNumbers: '15 → 22' },
    { id: '22', title: 'Cheapest', eta: '28 min', price: "3 500 so'm", walking: '300 m', transfers: 2, routeNumbers: '22 → 7' },
    { id: 'walk', title: 'Walking only', eta: '55 min', price: "0 so'm", walking: '5.5 km', transfers: 0 }
  ]
}
