local groups = {
	"Normal", "NormalFloat", "FloatBorder", "Pmenu", "Terminal", "EndOfBuffer",
	"FoldColumn", "Folded", "SignColumn", "LineNr", "CursorLineNr", "NormalNC",
	"WhichKeyFloat", "TelescopeBorder", "TelescopeNormal", "TelescopePromptBorder",
	"TelescopePromptTitle", "NeoTreeNormal", "NeoTreeNormalNC", "NeoTreeVertSplit",
	"NeoTreeWinSeparator", "NeoTreeEndOfBuffer", "NvimTreeNormal", "NvimTreeVertSplit",
	"NvimTreeEndOfBuffer", "NotifyINFOBody", "NotifyERRORBody", "NotifyWARNBody",
	"NotifyTRACEBody", "NotifyDEBUGBody", "NotifyINFOTitle", "NotifyERRORTitle",
	"NotifyWARNTitle", "NotifyTRACETitle", "NotifyDEBUGTitle", "NotifyINFOBorder",
	"NotifyERRORBorder", "NotifyWARNBorder", "NotifyTRACEBorder", "NotifyDEBUGBorder",
}

local original_backgrounds = {}

local function set_background(name, background)
	local ok, hl = pcall(vim.api.nvim_get_hl, 0, { name = name, link = false })
	if ok then
		hl.bg = background
		vim.api.nvim_set_hl(0, name, hl)
	end
end

local function make_transparent(name)
	local ok, hl = pcall(vim.api.nvim_get_hl, 0, { name = name, link = false })
	if ok then
		hl.bg = nil
		vim.api.nvim_set_hl(0, name, hl)
	end
end

local function apply_transparency()
	for _, name in ipairs(groups) do
		local ok, hl = pcall(vim.api.nvim_get_hl, 0, { name = name, link = false })
		if ok and hl.bg then
			original_backgrounds[name] = hl.bg
		end
		if vim.g.transparency_enabled then
			make_transparent(name)
		else
			set_background(name, original_backgrounds[name] or vim.g.terminal_color_0 or "#1E1D23")
		end
	end
end

vim.g.transparency_enabled = vim.g.transparency_enabled ~= false

vim.api.nvim_create_user_command("TransparencyToggle", function()
	vim.g.transparency_enabled = not vim.g.transparency_enabled
		local colorscheme = vim.g.colors_name
		if colorscheme then
			vim.cmd.colorscheme(colorscheme)
		end
		vim.notify("Transparency " .. (vim.g.transparency_enabled and "enabled" or "disabled"))
	end, { desc = "Toggle editor transparency", force = true })

local group = vim.api.nvim_create_augroup("transparency", { clear = true })
vim.api.nvim_create_autocmd("ColorScheme", { group = group, callback = apply_transparency })
vim.keymap.set("n", "<leader>ut", "<cmd>TransparencyToggle<cr>", { desc = "Toggle Transparency" })
apply_transparency()
