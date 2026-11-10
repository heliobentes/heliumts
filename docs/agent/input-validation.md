# Understand input parser behavior

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Define one validated method](./validation.md)

The optional input parser accepts unknown and returns validated arguments, synchronously or asynchronously. A parser object with parse(input) is also supported. Parser failures return a safe Invalid method arguments error without leaking submitted values or schema details. TypeScript types alone do not validate network input. Validation does not replace authentication or ownership checks in the handler/middleware.

Related: [Preserve application security](./security.md).
