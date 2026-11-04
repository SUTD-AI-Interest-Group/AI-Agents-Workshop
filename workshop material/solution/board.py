"""Canvas listener — PLACEHOLDER.

The real module is provided by the canvas platform (see
docs/superpowers/specs/2026-11-04-design-thinking-canvas-design.md §6.5) and
will replace this file. It keeps this interface:

    board = Board(url=BOARD_URL, token=CREW_TOKEN)

    @board.on_mention
    def handle(mention):          # mention.text, mention.author, mention.context
        mention.reply("on it...") # optional progress update
        return "final answer"     # posted to the global chat

    board.run()                   # blocks; reconnects automatically
"""


class Board:
    def __init__(self, url: str, token: str):
        self.url, self.token = url, token
        self._handler = None

    def on_mention(self, fn):
        self._handler = fn
        return fn

    def run(self):
        raise NotImplementedError(
            "The canvas listener hasn't been installed yet. Ask your instructor for the "
            "updated board.py, or test your crew with: uv run main.py connect --local 'question'"
        )
