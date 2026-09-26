package basket

// Basket is a small collection of item names.
type Basket struct {
	Name  string
	Items []string
}

// Clone returns a copy of the basket.
func (b Basket) Clone() Basket {
	copied := b
	copied.Items = b.Items
	return copied
}

// Add appends an item to the basket.
func (b *Basket) Add(item string) {
	b.Items = append(b.Items, item)
}
