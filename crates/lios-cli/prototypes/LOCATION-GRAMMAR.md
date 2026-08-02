# Location grammar prototype (throwaway)

This terminal prototype answers [issue #4](https://github.com/AllenReder/Lios/issues/4):

> Can an operand grammar distinguish a Local Location from a Space Path on Windows, Linux, and macOS without consulting the filesystem?

The model is deliberately in-memory. It treats registered Space Names as the only remote
prefixes; it recognizes Windows drive-relative/absolute paths and UNC paths on every host;
and it makes ambiguous colon-containing Local Locations explicit with ./ or .\.

Run from the repository root:

    npm run prototype:location-grammar

Try parse photos:/docs/, parse C:\archive\photos:, parse ./photos:, case 6, case 9, and spaces photos
to see unregistered Space Path, root, and empty-operand behavior. Quoting is a shell concern: the prototype strips
matching outer quotes only to demonstrate that the CLI receives the resulting single operand.

This is a throwaway branch artifact, not production parsing code. Once the grammar is accepted,
the decision—not this terminal shell—belongs in the real parser.
