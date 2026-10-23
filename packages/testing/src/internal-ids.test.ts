import { findInternalIds } from "./internal-ids";

const IDS = new Set([3, 17]);
const PUBLIC_ID = "0192f0c4-0000-7000-8000-000000000001";

describe("findInternalIds", () => {
  it.for([
    ["a planted id", `{"id":17,"name":"Acme"}`, [`"id":17`]],
    ["an id as a string", `{"id":"3"}`, [`"id":"3"`]],
    ["an internal-ID key, whatever its value", `{"organizationId":"7"}`, [`"organizationId":`]],
    ["a foreign key with spaces", `{ "userId" : 99 }`, [`"userId" :`]],
    [
      "keys escaped inside an RSC string",
      String.raw`self.__next_f.push([1,"{\"id\":3,\"memberId\":1}"])`,
      [String.raw`\"memberId\":`, String.raw`\"id\":3`],
    ],
  ] as const)("finds %s", ([, body, found]) => {
    expect(findInternalIds(body, IDS)).toEqual(found);
  });

  it.for([
    ["a publicId", `{"id":"${PUBLIC_ID}","organizationPublicId":"${PUBLIC_ID}"}`],
    ["an id that isn't one of the journey's", `{"id":4}`],
    ["a non-numeric id", `{"id":"sign-in-email","other":{"id":"base-ui-:r1:"}}`],
    ["a number that only starts like an id", `{"id":3.5,"x":{"id":17abc}}`],
    ["an id-like word outside a key", `"userId is not a key here"`],
  ] as const)("ignores %s", ([, body]) => {
    expect(findInternalIds(body, IDS)).toEqual([]);
  });
});
