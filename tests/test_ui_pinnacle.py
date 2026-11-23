"""Playwright coverage for the command palette.

Sidebar search writes a filtered slice onto ``state.chats``. The palette
must still find every chat, Tab must not move the highlighted row, and
Generic NovelAI must treat a shared AetherRoom token as ready.
"""
from __future__ import annotations

import json
from urllib.request import Request, urlopen

import pytest


pytest.importorskip("playwright")
from playwright.sync_api import Page

from tests.test_ui import (  # noqa: E402
    base_url,
    browser,  # noqa: F401
    page,  # noqa: F401
    _server,  # noqa: F401
    clean_state,  # noqa: F401
    _api_create_chat_with,
    _api_create_contact,
    _api_create_user,
)


def _put_settings(payload: dict) -> dict:
    body = json.dumps(payload).encode()
    req = Request(
        f"{base_url()}/api/settings",
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    return json.loads(urlopen(req, timeout=5).read())


@pytest.fixture
def restored_settings():
    """Token cases mutate global settings on the shared UI server."""
    yield
    _put_settings({
        "provider_mode": "aetherroom",
        "api_token": "",
        "generic": {
            "provider": "novelai",
            "novelai": {"api_token": ""},
        },
    })


def _active_label(page: Page) -> str:
    return page.locator(
        "#pinnacle-palette .pinnacle-option.active .pinnacle-option-label"
    ).inner_text()


def _open_palette(page: Page) -> None:
    page.click("#pinnacle-mark")
    page.wait_for_selector("#pinnacle-palette-input", timeout=5000)
    page.wait_for_selector("#pinnacle-palette .pinnacle-option.active", timeout=5000)


def _put_generic_novelai(*, aer_token: str, novelai_token: str) -> dict:
    return _put_settings({
        "provider_mode": "generic",
        "api_token": aer_token,
        "generic": {
            "provider": "novelai",
            "novelai": {
                "api_token": novelai_token,
                "model_id": "clio-v1",
            },
        },
    })


def _put_generic_openai(*, aer_token: str, own_token: str) -> dict:
    return _put_settings({
        "provider_mode": "generic",
        "api_token": aer_token,
        "generic": {
            "provider": "openai_compatible",
            "openai_compatible": {
                "active_id": "palette-oai",
                "custom_providers": [{
                    "id": "palette-oai",
                    "label": "Palette OA",
                    "base_url": "http://127.0.0.1:9/v1",
                    "api_token": own_token,
                    "model_id": "palette-model",
                }],
            },
        },
    })


def _assert_key_state(page: Page, *, ready: bool) -> None:
    page.goto(base_url())
    page.wait_for_selector("#pinnacle-pip", timeout=5000)
    page.wait_for_function(
        """() => {
          const mark = document.getElementById('pinnacle-mark');
          const title = mark && mark.title || '';
          return title && !title.includes('Loading') && !title.includes('Reading settings');
        }""",
        timeout=5000,
    )
    pip = page.locator("#pinnacle-pip").get_attribute("data-ready")
    assert pip == ("1" if ready else "0"), pip
    title = page.locator("#pinnacle-mark").get_attribute("title") or ""
    assert ("Key saved" if ready else "Key missing") in title
    _open_palette(page)
    add_key = page.locator(
        "#pinnacle-palette .pinnacle-option-label",
        has_text="Add an API key",
    )
    assert add_key.count() == (0 if ready else 1)
    page.keyboard.press("Escape")
    page.wait_for_selector("#pinnacle-palette", state="hidden")


def test_palette_search_finds_chat_hidden_by_sidebar_filter(page: Page, clean_state):
    """A sidebar search for one chat must not hide the other from the palette."""
    _api_create_contact("PaletteKeeper")
    user_id = _api_create_user("PaletteGuest")
    contacts = json.load(urlopen(f"{base_url()}/api/contacts", timeout=3))
    contact_id = next(c["id"] for c in contacts if c["name"] == "PaletteKeeper")
    _api_create_chat_with(
        contact_id=contact_id, user_id=user_id, title="Astra night",
    )
    _api_create_chat_with(
        contact_id=contact_id, user_id=user_id, title="Mara rain",
    )

    page.goto(f"{base_url()}/chats")
    page.wait_for_function(
        """() => {
          const text = document.querySelector('#chat-list-body')?.innerText || '';
          return text.includes('Astra night') && text.includes('Mara rain');
        }""",
        timeout=5000,
    )
    page.locator("#main .list-search").fill("Astra")
    page.wait_for_function(
        """() => {
          const text = document.querySelector('#chat-list-body')?.innerText || '';
          return text.includes('Astra night') && !text.includes('Mara rain');
        }""",
        timeout=5000,
    )

    bare_lists: list[str] = []

    def _on_request(request):
        if request.method == "GET" and request.url.rstrip("/").endswith("/api/chats"):
            bare_lists.append(request.url)

    page.on("request", _on_request)
    _open_palette(page)
    page.locator("#pinnacle-palette-input").click()
    page.keyboard.type("Mara", delay=20)
    page.wait_for_selector(
        "#pinnacle-palette .pinnacle-option-label:text-is('Mara rain')",
        timeout=5000,
    )
    assert len(bare_lists) == 1, bare_lists

    sidebar = page.locator("#chat-list-body").inner_text()
    assert "Astra night" in sidebar
    assert "Mara rain" not in sidebar
    labels = page.locator("#pinnacle-palette .pinnacle-option-label").all_inner_texts()
    assert "Mara rain" in labels
    assert "Astra night" not in labels

    page.keyboard.press("Enter")
    page.wait_for_function(
        """() => document.querySelector('.chat-header input.title')?.value === 'Mara rain'""",
        timeout=5000,
    )


def test_palette_tab_does_not_change_selection_enter_follows_arrow(
    page: Page, clean_state,
):
    """Tab leaves the highlighted row alone. ArrowDown moves it. Enter runs it."""
    page.goto(base_url())
    page.wait_for_selector("#pinnacle-mark", timeout=5000)
    _open_palette(page)
    assert _active_label(page) == "Chats"
    tab_indexes = page.eval_on_selector_all(
        "#pinnacle-palette .pinnacle-option",
        "els => els.map(el => el.tabIndex)",
    )
    assert tab_indexes and all(index == -1 for index in tab_indexes)

    page.keyboard.press("Tab")
    assert _active_label(page) == "Chats"
    assert page.evaluate(
        """() => {
          const el = document.activeElement;
          return !el || !el.classList.contains('pinnacle-option');
        }"""
    )

    page.keyboard.press("ArrowDown")
    assert _active_label(page) == "Contacts"
    page.keyboard.press("Enter")
    page.wait_for_selector("#contact-list-body", timeout=5000)
    assert page.locator("#pinnacle-palette").is_hidden()
    assert page.eval_on_selector(
        '.rail-btn[data-tab="contacts"]',
        "el => el.classList.contains('active')",
    )


def test_palette_query_change_resets_highlight(page: Page, clean_state):
    """A new query starts back at the first match instead of keeping an old index."""
    page.goto(base_url())
    page.wait_for_selector("#pinnacle-mark", timeout=5000)
    _open_palette(page)
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    assert _active_label(page) == "User personas"
    page.locator("#pinnacle-palette-input").fill("chat")
    assert _active_label(page) == "Chats"


def test_generic_novelai_ready_with_only_aetherroom_token(
    page: Page, restored_settings,
):
    view = _put_generic_novelai(aer_token="aer-shared", novelai_token="")
    assert view["provider_mode"] == "generic"
    assert view["generic"]["provider"] == "novelai"
    assert view["api_token_indicator"] == "__present__"
    assert view["generic"]["novelai"]["api_token_indicator"] == ""
    _assert_key_state(page, ready=True)


def test_generic_novelai_ready_with_only_provider_token(
    page: Page, restored_settings,
):
    view = _put_generic_novelai(aer_token="", novelai_token="nai-only")
    assert view["api_token_indicator"] == ""
    assert view["generic"]["novelai"]["api_token_indicator"] == "__present__"
    _assert_key_state(page, ready=True)


def test_generic_novelai_not_ready_without_token(page: Page, restored_settings):
    view = _put_generic_novelai(aer_token="", novelai_token="")
    assert view["api_token_indicator"] == ""
    assert view["generic"]["novelai"]["api_token_indicator"] == ""
    _assert_key_state(page, ready=False)


def test_openai_compatible_ready_depends_on_its_own_key(
    page: Page, restored_settings,
):
    """The AetherRoom token does not satisfy an OpenAI-compatible provider."""
    missing = _put_generic_openai(aer_token="aer-shared", own_token="")
    assert missing["api_token_indicator"] == "__present__"
    entry = missing["generic"]["openai_compatible"]["custom_providers"][0]
    assert entry["api_token_indicator"] == ""
    assert missing["generic"]["openai_compatible"]["active_id"] == "palette-oai"
    _assert_key_state(page, ready=False)

    present = _put_generic_openai(aer_token="", own_token="sk-palette")
    assert present["api_token_indicator"] == ""
    entry = present["generic"]["openai_compatible"]["custom_providers"][0]
    assert entry["api_token_indicator"] == "__present__"
    _assert_key_state(page, ready=True)
