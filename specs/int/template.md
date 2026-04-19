# INT-XXXX: Title

- **Status**: Draft
- **Owner**: @handle
- **External system**: name, version, vendor

## Purpose

What capability does this integration deliver to the product?

## Transport

Medium (USB-serial, HTTP, BLE, …), protocol, encoding, rates, framing.

## Message catalogue

Every message type we send or receive. For binary protocols: byte layout.
For text protocols: exact grammar with examples.

## State machine

Who initiates, what the valid states are, and which transitions are allowed.
Include error/reset paths.

## Error handling

What can go wrong? Timeouts, malformed frames, unexpected state, device
disconnect. How does the adapter recover?

## Test fixtures

Example captures (real or synthetic) used in unit tests. Paths to fixture
files.

## Open questions

Things we haven't verified against real hardware yet.
