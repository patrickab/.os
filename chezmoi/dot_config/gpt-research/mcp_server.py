#!/usr/bin/env python3
import os
from mcp.server.fastmcp.server import FastMCP, TransportSecuritySettings

mcp = FastMCP(
    "gpt-researcher",
    host="0.0.0.0",
    port=int(os.environ.get("MCP_PORT", "8000")),
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
    ),
)


@mcp.tool()
async def research(query: str, report_type: str = "research_report") -> str:
    """Perform deep research on a given query and return a detailed report.

    Args:
        query: The research question or topic to investigate.
        report_type: Type of report (research_report, detailed_report, etc.).
    """
    from gpt_researcher import GPTResearcher

    researcher = GPTResearcher(
        query=query,
        report_type=report_type,
    )
    await researcher.conduct_research()
    report = await researcher.write_report()
    return report


@mcp.tool()
async def quick_research(query: str) -> str:
    """Perform a quick, focused research lookup for concise answers.

    Args:
        query: The question or topic for quick research.
    """
    from gpt_researcher import GPTResearcher

    researcher = GPTResearcher(
        query=query,
        report_type="research_report",
    )
    await researcher.conduct_research()
    report = await researcher.write_report()
    return report


if __name__ == "__main__":
    mcp.run(transport="streamable-http")