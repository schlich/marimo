# Copyright 2024 Marimo. All rights reserved.
from __future__ import annotations

import os
import sys
from typing import Optional

from marimo._cli.print import bold, green, muted
from marimo._config.config import MarimoConfig
from marimo._server.utils import print_, print_tabbed

UTF8_SUPPORTED = False

try:
    "🌊🍃".encode(sys.stdout.encoding)
    UTF8_SUPPORTED = True
except Exception:
    pass


def print_startup(
    *, file_name: Optional[str], url: str, run: bool, new: bool, network: bool
) -> None:
    print_()
    if file_name is not None and not run:
        print_tabbed(
            f"{green(f'Edit {os.path.basename(file_name)} in your browser', bold=True)} {_utf8('📝')}"
        )
    elif file_name is not None and run:
        print_tabbed(
            f"{green(f'Running {os.path.basename(file_name)}', bold=True)} {_utf8('⚡')}"
        )
    elif new:
        print_tabbed(
            f"{green('Create a new notebook in your browser', bold=True)} {_utf8('📝')}"
        )
    else:
        print_tabbed(
            f"{green('Create or edit notebooks in your browser', bold=True)} {_utf8('📝')}"
        )
    print_()
    print_tabbed(f"{_utf8('➜')}  {green('URL')}: {_colorized_url(url)}")
    if network:
        try:
            print_tabbed(
                f"{_utf8('➜')}  {green('Network')}: {_colorized_url(_get_network_url(url))}"
            )
        except Exception:
            # If we can't get the network URL, just skip it
            pass
    print_()


def print_shutdown() -> None:
    print_()
    print_tabbed(
        "\033[32mThanks for using marimo!\033[0m {}".format(_utf8("🌊🍃"))
    )
    print_()


def _get_network_url(url: str) -> str:
    import socket

    hostname = socket.gethostname()
    try:
        # Find a non-loopback IPv4 address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Doesn't need to be reachable
        s.connect(("255.255.255.254", 1))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        try:
            # Get all IPs for the hostname
            all_ips = socket.getaddrinfo(hostname, None)
            # Filter for IPv4 addresses that aren't loopback
            for ip_info in all_ips:
                family, _, _, _, addr = ip_info
                if family == socket.AF_INET and not str(addr[0]).startswith(
                    "127."
                ):
                    local_ip = addr[0]
                    break
            else:
                # If no suitable IP found, fall back to hostname
                local_ip = hostname
        except Exception:
            # Final fallback to hostname
            local_ip = hostname

    # Replace the host part of the URL with the local IP
    from urllib.parse import urlparse, urlunparse

    parsed_url = urlparse(url)
    new_netloc = local_ip + (f":{parsed_url.port}" if parsed_url.port else "")
    new_url = urlunparse(parsed_url._replace(netloc=new_netloc))

    return new_url


def _colorized_url(url_string: str) -> str:
    from urllib.parse import urlparse

    url = urlparse(url_string)
    if url.query:
        query = muted(f"?{url.query}")
    else:
        query = ""

    url_string = f"{url.scheme}://{url.hostname}"
    # raw https and http urls do not have a port to parse
    try:
        if url.port:
            url_string += f":{url.port}"
    except Exception:
        # If the port is not a number, don't include it
        pass

    return bold(
        f"{url_string}{url.path}{query}",
    )


def _utf8(msg: str) -> str:
    return msg if UTF8_SUPPORTED else ""


def print_experimental_features(config: MarimoConfig) -> None:
    if "experimental" not in config:
        return

    keys = set(config["experimental"].keys())

    # These experiments have been released
    finished_experiments = {
        "rtc",
        "lsp",
        "chat_sidebar",
        "multi_column",
        "scratchpad",
        "tracing",
        "markdown",
        "sql_engines",
        "secrets",
        "reactive_tests",
        "toplevel_defs",
        "setup_cell",
    }
    keys = keys - finished_experiments

    if len(keys) == 0:
        return

    print_tabbed(
        f"{_utf8('🧪')} {green('Experimental features (use with caution)')}: {', '.join(keys)}"
    )
