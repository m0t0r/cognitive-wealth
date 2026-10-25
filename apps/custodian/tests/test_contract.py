import json

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, validate
from jsonschema.exceptions import ValidationError as SchemaError
from pydantic import ValidationError

from custodian.feed import Manifest
from custodian.main import OPENAPI_PATH, app

# A row of the primer's Friday Delivery: the Reversal of Tuesday's wrong dividend.
REVERSAL = {
    "transaction_id": "TX-000000009",
    "account_number": "CW-000001",
    "kind": "reversal",
    "reverses": "TX-000000005",
    "security": "LKBF",
    "shares": None,
    "amount": "-9.00",
    "trade_date": "2026-03-03",
    "settlement_date": "2026-03-03",
    "posting_date": "2026-03-06",
}


def served_field(component: str, field: str) -> dict[str, object]:
    """One field's schema, in the document the app serves at /openapi.json (and /docs shows)."""
    document = TestClient(app).get("/openapi.json").json()
    return document["components"]["schemas"][component]["properties"][field]


def assert_fits_component(component: str, instance: object) -> None:
    """Validate `instance` against one of the served document's components, as Zod will."""
    document = TestClient(app).get("/openapi.json").json()
    # A `$ref` at the top, next to the document's `components`, points the validator at one.
    schema = {**document, "$ref": f"#/components/schemas/{component}"}
    # The format checker makes "format": "date" a check, not just a note.
    validate(
        instance,
        schema,
        cls=Draft202012Validator,
        format_checker=Draft202012Validator.FORMAT_CHECKER,
    )


def test_the_committed_openapi_json_matches_the_app() -> None:
    # Cognitive Wealth generates its client from this file, so it must not drift.
    # Regenerate it with `pnpm --filter custodian openapi:write`.
    assert json.loads(OPENAPI_PATH.read_text()) == app.openapi()


@pytest.mark.parametrize(
    "component",
    [
        "AccountRow",
        "Manifest",
        "ManifestFile",
        "PositionRow",
        "PriceRow",
        "SecurityRow",
        "TransactionRow",
    ],
)
def test_the_feed_rows_and_the_manifest_are_components_though_no_route_returns_them(
    component: str,
) -> None:
    # Strict, like the model: a column the contract doesn't name is an error.
    document = TestClient(app).get("/openapi.json").json()
    assert document["components"]["schemas"][component]["additionalProperties"] is False


def test_a_feed_row_passes_the_contract() -> None:
    assert_fits_component("TransactionRow", REVERSAL)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        # A JSON number has been through a float, so an amount must be a decimal string.
        ("amount", -9),
        ("amount", "-9e0"),
        ("amount", ""),
        ("shares", 1.5),
        # Money is whole cents and Shares six decimal places (ADR 0013), and the writer always
        # writes exactly that many, so any other number of places isn't something it sent.
        ("amount", "-9"),
        ("amount", "-9.0"),
        ("amount", "10.123"),
        ("shares", "40"),
        ("shares", "40.0"),
        ("shares", "40.0000001"),
        ("trade_date", "2026-3-3"),
        ("trade_date", "03/03/2026"),
        ("kind", "refund"),
    ],
)
def test_a_feed_row_with_a_bad_value_fails_the_contract(field: str, value: object) -> None:
    with pytest.raises(SchemaError):
        assert_fits_component("TransactionRow", {**REVERSAL, field: value})


def test_a_manifest_must_say_its_format_version() -> None:
    # A reader refuses a format it can't read, so a Manifest that doesn't say which one it is
    # fails both the contract and the model: neither assumes version 1.
    unversioned: dict[str, object] = {"as_of_date": "2026-03-02", "files": []}
    with pytest.raises(SchemaError):
        assert_fits_component("Manifest", unversioned)
    with pytest.raises(ValidationError):
        Manifest.model_validate(unversioned)

    assert_fits_component("Manifest", {"format_version": 1, **unversioned})
    Manifest.model_validate({"format_version": 1, **unversioned})


@pytest.mark.parametrize("price", ["150.25", "10", "0.1234"])
def test_a_price_has_as_many_places_as_its_source_quotes(price: str) -> None:
    # A Price has no fixed scale (ADR 0013), so any plain decimal fits.
    assert_fits_component("PriceRow", {"security": "LKSF", "price": price})


def test_shares_with_six_places_fit() -> None:
    assert_fits_component("TransactionRow", {**REVERSAL, "shares": "-40.000000"})


def test_a_field_docstring_becomes_its_description() -> None:
    # So the API docs at /docs say what each column means.
    assert served_field("ManifestFile", "rows")["description"] == "Not counting the header row."


def test_the_api_docs_show_the_same_document() -> None:
    client = TestClient(app)

    assert client.get("/openapi.json").json() == app.openapi()
    docs = client.get("/docs")
    assert docs.status_code == 200
    assert "swagger-ui" in docs.text
