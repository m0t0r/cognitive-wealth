import { csvRow } from "./csv";

describe("csvRow", () => {
  it("joins plain values with commas and ends the line with CRLF", () => {
    expect(csvRow(["1", "Acme", "2026-01-01"])).toBe("1,Acme,2026-01-01\r\n");
  });

  it("quotes a value with a comma, a double quote or a line break, doubling its quotes", () => {
    expect(csvRow(["a,b", 'say "hi"', "one\ntwo", "cr\rhere"])).toBe(
      '"a,b","say ""hi""","one\ntwo","cr\rhere"\r\n',
    );
  });

  it("tells null (an empty field) from an empty string (two quotes), as Postgres's COPY does", () => {
    expect(csvRow([null, "", "x"])).toBe(',"",x\r\n');
  });

  it("quotes a value with leading or trailing spaces, so a reader can't trim them", () => {
    expect(csvRow([" padded ", "inner space"])).toBe('" padded ",inner space\r\n');
  });
});
