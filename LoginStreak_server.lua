--[[
	LoginStreak.server.lua  (proteksi lisensi sudah dipasang di atas)
]]

-- ===================== PROTEKSI LISENSI (inline) ========================
do
	-- ===== Proteksi Lisensi (ubah hanya bagian SETTINGS) =====
	local HttpService = game:GetService("HttpService")
	local Players     = game:GetService("Players")

	----- SETTINGS -----
	local PRODUCT_ID  = "GANTI_DENGAN_ID_PRODUK"
	local LICENSE_URL = "https://roblox-license.namamu.workers.dev/api/verify"
	local KICK_MSG    = "Sistem ini tidak berlisensi untuk game ini."
	local FAIL_OPEN   = true    -- true: kalau server lisensi down, game tetap jalan (ramah pembeli).
	                            -- false: kalau tak bisa verifikasi, game dimatikan (anti-bajak lebih ketat).
	local RECHECK_SEC = 300     -- selang cek ulang (detik)
	local MAX_SKEW    = 120     -- toleransi selisih waktu respon (detik)
	--------------------

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
		if not ok2 or type(data) ~= "table" then return nil end
		if data.nonce ~= nonce then return nil end                 -- cegah balasan palsu / replay
		if type(data.ts) == "number" then
			local ts = data.ts; if ts > 1e11 then ts = ts / 1000 end -- toleran detik atau milidetik
			if math.abs(os.time() - ts) > MAX_SKEW then return nil end -- tolak respon basi
		end
		return data.authorized == true
	end

	local function definitive()
		for _ = 1, 4 do
			local r = check()
			if r ~= nil then return r end
			task.wait(3 + math.random() * 2)
		end
		return nil
	end

	-- true = berlisensi, false = ditolak pasti, nil = tidak yakin (outage)
	local function verdict()
		local a = definitive()
		if a == true then return true end
		if a == false then
			task.wait(6)
			if definitive() == false then return false end
			return nil
		end
		return nil
	end

	local kicked = false
	local function shutdown(reason)
		if kicked then return end
		kicked = true
		warn("[Lisensi] " .. tostring(reason) .. " - sistem dimatikan.")
		Players.PlayerAdded:Connect(function(p) pcall(function() p:Kick(KICK_MSG) end) end)
		for _, p in ipairs(Players:GetPlayers()) do pcall(function() p:Kick(KICK_MSG) end) end
	end

	local v = verdict()
	if v == false or (v == nil and not FAIL_OPEN) then
		shutdown(v == false and "Tidak ter-whitelist" or "Tidak bisa memverifikasi")
		return
	end

	task.spawn(function()
		while not kicked do
			task.wait(RECHECK_SEC)
			local vv = verdict()
			if vv == false or (vv == nil and not FAIL_OPEN) then
				shutdown(vv == false and "Whitelist dicabut" or "Tidak bisa memverifikasi")
				break
			end
		end
	end)
end
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
