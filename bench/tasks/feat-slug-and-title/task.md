Our article URLs need to be built from the title: add a `slugify` helper and
use it in `formatTitle` so the slug is always lowercase, words joined by a
single dash. The tests describe the expected behaviour.
