package basket

import "testing"

func TestCloneIsIndependent(t *testing.T) {
	original := Basket{Name: "left", Items: []string{"apple"}}
	cloned := original.Clone()
	cloned.Add("pear")

	if len(original.Items) != 1 {
		t.Fatalf("the original basket changed: %v", original.Items)
	}
	if len(cloned.Items) != 2 {
		t.Fatalf("the clone did not get the item: %v", cloned.Items)
	}
}

func TestCloneKeepsEverythingElse(t *testing.T) {
	original := Basket{Name: "left", Items: []string{"apple", "plum"}}
	cloned := original.Clone()
	if cloned.Name != original.Name {
		t.Fatalf("name changed: %q", cloned.Name)
	}
	if len(cloned.Items) != 2 || cloned.Items[0] != "apple" || cloned.Items[1] != "plum" {
		t.Fatalf("items changed: %v", cloned.Items)
	}
}
