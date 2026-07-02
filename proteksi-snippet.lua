do
	local HttpService = game:GetService("HttpService")
	local Players     = game:GetService("Players")
	local RunService  = game:GetService("RunService")
	local PRODUCT_ID  = "GANTI_DENGAN_ID_PRODUK"
	local LICENSE_URL = "https://roblox-license.namamu.workers.dev/api/verify"
	local KICK_MSG    = "Sistem ini tidak berlisensi untuk game ini."
	local function check()
		local nonce = HttpService:GenerateGUID(false)
		local ok, res = pcall(function()
			return HttpService:PostAsync(LICENSE_URL, HttpService:JSONEncode({
				productId = PRODUCT_ID, creatorId = game.CreatorId,
				creatorType = game.CreatorType.Name, placeId = game.PlaceId, nonce = nonce,
			}), Enum.HttpContentType.ApplicationJson)
		end)
		if not ok then return nil end
		local ok2, data = pcall(function() return HttpService:JSONDecode(res) end)
		if not ok2 or type(data) ~= "table" or data.nonce ~= nonce then return nil end
		return data.authorized == true
	end
	local function definitive()
		for _ = 1, 4 do
			local r = check()
			if r ~= nil then return r end
			task.wait(3)
		end
		return nil
	end
	local function deniedTwice()
		if definitive() ~= false then return false end
		task.wait(6)
		return definitive() == false
	end
	local kicked = false
	local function shutdown(reason)
		if kicked then return end
		kicked = true
		warn("[Lisensi] " .. tostring(reason) .. " - sistem dimatikan.")
		Players.PlayerAdded:Connect(function(p) pcall(function() p:Kick(KICK_MSG) end) end)
		for _, p in ipairs(Players:GetPlayers()) do pcall(function() p:Kick(KICK_MSG) end) end
	end
	if deniedTwice() then
		shutdown("Tidak ter-whitelist")
		return
	end
	task.spawn(function()
		while not kicked do
			task.wait(300)
			if deniedTwice() then
				shutdown("Whitelist dicabut")
				break
			end
		end
	end)
end
-- ================================================
