--[[
	LoginStreak.server.lua  (contoh: proteksi lisensi sudah dipasang di atas)
]]

-- ===================== PROTEKSI LISENSI (inline) ========================
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
				productId   = PRODUCT_ID,
				creatorId   = game.CreatorId,
				creatorType = game.CreatorType.Name,
				placeId     = game.PlaceId,
				nonce       = nonce,
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

	-- Verifikasi awal. Studio sekarang JUGA di-shutdown kalau tidak ter-whitelist.
	if deniedTwice() then
		shutdown("Tidak ter-whitelist")
		return
	end

	-- Pengawas berkala: kalau kamu cabut whitelist, sistem mati sendiri (termasuk di Studio).
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
-- =================== AKHIR PROTEKSI LISENSI =============================


local Players          = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local streakStore      = DataStoreService:GetDataStore("LoginStreak_v1")
local ONE_DAY = 86400
local function updateStreak(player)
	local userId = tostring(player.UserId)
	local now    = os.time()
	local ok, data = pcall(function() return streakStore:GetAsync(userId) end)
	if not ok then data = nil end
	local streak    = 0
	local lastLogin = 0
	if type(data) == "table" then
		streak    = data.streak    or 0
		lastLogin = data.lastLogin or 0
	end
	local diff = now - lastLogin
	if diff >= ONE_DAY * 2 then
		streak = 1
	elseif diff >= ONE_DAY then
		streak = streak + 1
	end
	pcall(function()
		streakStore:SetAsync(userId, { lastLogin = now, streak = streak })
	end)
	local ls = player:WaitForChild("leaderstats", 10)
	if not ls then
		warn("[LoginStreak] leaderstats tidak muncul untuk", player.Name, "- LoginStreak dilewati.")
		return
	end
	local sv = ls:FindFirstChild("LoginStreak")
	if not sv then
		sv        = Instance.new("IntValue")
		sv.Name   = "LoginStreak"
		sv.Parent = ls
	end
	sv.Value = streak
end
Players.PlayerAdded:Connect(function(player)
	task.spawn(updateStreak, player)
end)
for _, p in ipairs(Players:GetPlayers()) do
	task.spawn(updateStreak, p)
end
