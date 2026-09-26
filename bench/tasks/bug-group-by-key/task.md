`groupBy` puts every item in the last bucket — `groupBy(users, u => u.role)`
returns a single key. The tests in `test/` show what it should do. Fix the
source, not the tests.
