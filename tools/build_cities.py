"""Write data/places.json: important cities and the years they mattered, each under the name it had at the time.
One city can have several entries (renamed, or capital in one period and a regional centre in another).
Drafted from general knowledge (AI-written, not source-checked); years are approximate.
Fields: id, name/name_zh, modern/modern_zh, lon/lat, rank (capital | secondary | major | port | frontier),
from/to, note/note_zh."""
import json

C = []
def city(modern_zh, modern, lon, lat, *spans):
    C.append((modern_zh, modern, lon, lat, spans))

# (from, to, name_zh, name, rank, note_zh, note)
city("偃师", "Yanshi", 112.69, 34.69,
     (-1900, -1500, "二里头", "Erlitou", "capital", "二里头文化大型都邑，多认为是夏代晚期都城。", "Great Bronze Age site, often taken as the late Xia capital."),
     (-1600, -1400, "西亳", "Xibo", "major", "偃师商城，商代早期都城之一。", "Yanshi Shang city, an early Shang capital."))
city("郑州", "Zhengzhou", 113.65, 34.76,
     (-1600, -1300, "亳", "Bo (Zhengzhou)", "capital", "郑州商城，商代早期都城。", "Zhengzhou Shang city, early Shang capital."),
     (1906, 1912, "郑州", "Zhengzhou", "major", "京汉、汴洛铁路交汇，兴起为交通枢纽。", "Railway junction of the Beijing–Hankou and Kaifeng–Luoyang lines."))
city("安阳", "Anyang", 114.32, 36.12,
     (-1300, -1046, "殷", "Yin", "capital", "盘庚迁殷后的商都，出土甲骨文。", "Late Shang capital after Pan Geng's move; oracle bones found here."),
     (204, 580, "邺", "Ye", "capital", "曹魏王都，后为后赵、冉魏、前燕、东魏、北齐都城。", "Cao Wei seat, then capital of Later Zhao, Former Yan, Eastern Wei and Northern Qi."))
city("西安", "Xi'an", 108.94, 34.27,
     (-1046, -771, "镐京", "Haojing", "capital", "西周都城（宗周）。", "Western Zhou capital."),
     (-202, 25, "长安", "Chang'an", "capital", "西汉都城，丝绸之路起点。", "Western Han capital, start of the Silk Road."),
     (25, 581, "长安", "Chang'an", "major", "关中重镇，前赵、前秦、后秦、西魏、北周相继建都。", "Key city of Guanzhong; capital of Former Qin, Western Wei, Northern Zhou and others."),
     (582, 618, "大兴", "Daxing", "capital", "隋文帝新建都城，唐长安城前身。", "Sui capital built by Emperor Wen, basis of Tang Chang'an."),
     (618, 904, "长安", "Chang'an", "capital", "唐都，人口百万，世界最大城市之一。", "Tang capital of about a million people, among the largest cities on earth."),
     (905, 1368, "京兆", "Jingzhao", "major", "唐亡后降为西北重镇（宋京兆府、元奉元路）。", "After Tang, a regional centre of the northwest."),
     (1369, 1912, "西安", "Xi'an", "major", "明清陕西省城，西北军政中心。", "Provincial capital of Shaanxi under Ming and Qing."))
city("咸阳", "Xianyang", 108.71, 34.33,
     (-350, -207, "咸阳", "Xianyang", "capital", "秦孝公迁都于此，秦朝都城。", "Qin capital from 350 BCE."))
city("宝鸡", "Baoji", 107.4, 34.5,
     (-677, -383, "雍", "Yong", "capital", "春秋秦国都城近三百年。", "Capital of the state of Qin for three centuries."))
city("洛阳", "Luoyang", 112.45, 34.62,
     (-1038, -771, "洛邑", "Luoyi", "secondary", "周公营建的东都成周。", "Eastern capital founded by the Duke of Zhou."),
     (-770, -256, "洛邑", "Luoyi", "capital", "东周王城。", "Eastern Zhou royal capital."),
     (-255, 24, "洛阳", "Luoyang", "major", "三川郡治，关东第一大城。", "Largest city east of the passes."),
     (25, 190, "雒阳", "Luoyang", "capital", "东汉都城，太学所在。", "Eastern Han capital, home of the Imperial Academy."),
     (220, 311, "洛阳", "Luoyang", "capital", "曹魏、西晋都城，311年永嘉之乱被焚。", "Capital of Wei and Western Jin, sacked in 311."),
     (494, 534, "洛阳", "Luoyang", "capital", "北魏孝文帝迁都，佛寺林立。", "Northern Wei capital after 494, full of Buddhist temples."),
     (605, 907, "东都", "Eastern Capital", "secondary", "隋炀帝营建，唐东都，武周时为神都。", "Sui–Tang eastern capital; Wu Zetian's 'Divine Capital'."),
     (907, 1127, "西京", "Western Capital", "secondary", "后梁、后唐都城，北宋西京。", "Later Liang/Later Tang capital, Song western capital."))
city("开封", "Kaifeng", 114.31, 34.8,
     (-364, -225, "大梁", "Daliang", "capital", "战国魏国都城。", "Capital of the state of Wei."),
     (781, 906, "汴州", "Bianzhou", "major", "运河枢纽，宣武军治所。", "Grand Canal hub and seat of the Xuanwu army."),
     (907, 1127, "东京", "Dongjing (Bianliang)", "capital", "后梁至北宋都城，《清明上河图》所绘繁华。", "Capital of most Five Dynasties and of Northern Song."),
     (1214, 1233, "南京", "Nanjing (Jin)", "capital", "金宣宗南迁后的都城。", "Jin capital after the flight from Zhongdu."),
     (1234, 1912, "开封", "Kaifeng", "major", "河南省城。", "Provincial capital of Henan."))
city("商丘", "Shangqiu", 115.65, 34.44,
     (-1046, -286, "商丘", "Shangqiu (Song)", "capital", "宋国都城，商人后裔所封。", "Capital of Song, fief of the Shang descendants."),
     (1006, 1127, "南京", "Southern Capital", "secondary", "北宋应天府南京，宋太祖龙兴之地。", "Song southern capital, where the dynasty's founder rose."))
city("淄博", "Zibo", 118.31, 36.85,
     (-859, -221, "临淄", "Linzi", "capital", "齐国都城，战国最繁华城市，稷下学宫所在。", "Qi capital, richest city of the Warring States, seat of the Jixia Academy."),
     (-220, 300, "临淄", "Linzi", "major", "齐郡治，汉代五大都会之一。", "One of the five great cities of Han."))
city("曲阜", "Qufu", 116.99, 35.6,
     (-1040, -256, "曲阜", "Qufu", "capital", "鲁国都城，孔子故乡。", "Capital of Lu, Confucius's home town."),
     (-255, 1912, "曲阜", "Qufu", "major", "孔府、孔庙所在，衍圣公世居。", "Home of the Confucius temple and the Kong family."))
city("荆州", "Jingzhou", 112.2, 30.35,
     (-689, -278, "郢", "Ying", "capital", "楚国都城纪南城，278年为秦白起攻破。", "Chu capital until sacked by Qin in 278 BCE."),
     (-277, 1912, "江陵", "Jiangling", "major", "荆州治所，长江中游军事重镇。", "Seat of Jingzhou, the military key of the middle Yangtze."))
city("邯郸", "Handan", 114.49, 36.61,
     (-386, -228, "邯郸", "Handan", "capital", "赵国都城。", "Capital of Zhao."),
     (-227, 200, "邯郸", "Handan", "major", "汉代五大都会之一。", "One of the five great cities of Han."))
city("新郑", "Xinzheng", 113.73, 34.4,
     (-769, -230, "新郑", "Xinzheng", "capital", "郑国、后为韩国都城。", "Capital of Zheng, then of Han."))
city("侯马", "Houma", 111.37, 35.62,
     (-585, -376, "新田", "Xintian", "capital", "晋国都城。", "Capital of Jin."))
city("北京", "Beijing", 116.4, 39.9,
     (-1045, -226, "蓟", "Ji", "capital", "燕国都城。", "Capital of Yan."),
     (-225, 937, "幽州", "Youzhou", "frontier", "东北边防重镇，安禄山范阳节度使治所。", "Northern frontier base, seat of An Lushan's Fanyang command."),
     (938, 1152, "燕京", "Yanjing", "secondary", "辽南京析津府。", "Liao southern capital."),
     (1153, 1215, "中都", "Zhongdu", "capital", "金朝都城。", "Jin capital."),
     (1267, 1368, "大都", "Dadu (Khanbaliq)", "capital", "元朝都城，马可·波罗笔下的汗八里。", "Yuan capital, Marco Polo's Khanbaliq."),
     (1369, 1402, "北平", "Beiping", "major", "燕王朱棣封地。", "Fief of the Prince of Yan."),
     (1403, 1912, "北京", "Beijing", "capital", "明成祖迁都，明清都城。", "Ming and Qing capital."))
city("南京", "Nanjing", 118.78, 32.06,
     (229, 280, "建业", "Jianye", "capital", "孙吴都城。", "Capital of Wu."),
     (317, 589, "建康", "Jiankang", "capital", "东晋、宋、齐、梁、陈都城，六朝古都。", "Capital of Eastern Jin and the Southern Dynasties."),
     (590, 936, "金陵", "Jinling", "major", "隋灭陈后被毁，唐代为江南名城。", "Razed by Sui in 589, later a Tang regional city."),
     (937, 975, "江宁", "Jiangning", "capital", "南唐都城。", "Capital of Southern Tang."),
     (976, 1367, "建康", "Jiankang", "major", "宋元江南重镇，南宋行都之一。", "Major city of the lower Yangtze."),
     (1368, 1420, "应天", "Yingtian (Nanjing)", "capital", "明初都城。", "Early Ming capital."),
     (1421, 1912, "南京", "Nanjing", "secondary", "明南京留都，清两江总督驻地；1853—1864年为太平天国天京。", "Ming secondary capital; Qing seat of the Liangjiang viceroy; Taiping capital 1853–64."))
city("杭州", "Hangzhou", 120.16, 30.27,
     (610, 906, "杭州", "Hangzhou", "major", "大运河南端。", "Southern end of the Grand Canal."),
     (907, 978, "西府", "Hangzhou (Wuyue)", "capital", "吴越国都城。", "Capital of Wuyue."),
     (979, 1128, "杭州", "Hangzhou", "major", "“上有天堂，下有苏杭”。", "'Paradise above, Suzhou and Hangzhou below.'"),
     (1129, 1276, "临安", "Lin'an", "capital", "南宋行在，人口逾百万。", "Southern Song capital, over a million people."),
     (1277, 1912, "杭州", "Hangzhou", "major", "元代马可·波罗称为“行在”，明清浙江省城。", "Marco Polo's Quinsai; Zhejiang provincial capital."))
city("苏州", "Suzhou", 120.62, 31.3,
     (-514, -473, "吴", "Wu", "capital", "吴国都城，伍子胥筑城。", "Capital of the state of Wu."),
     (-472, 588, "吴", "Wu (Suzhou)", "major", "吴郡治所，江东大族顾陆朱张聚居。", "Seat of Wu commandery, home of the great southern clans."),
     (589, 1912, "苏州", "Suzhou", "major", "江南经济文化中心，明清最富庶城市之一。", "Economic and cultural centre of Jiangnan."))
city("绍兴", "Shaoxing", 120.58, 30.0,
     (-490, -334, "会稽", "Kuaiji", "capital", "越国都城，勾践卧薪尝胆。", "Capital of Yue, where Goujian plotted revenge."),
     (-333, 1912, "会稽", "Kuaiji (Shaoxing)", "major", "东晋南朝士族聚居之地。", "Home of the great clans of the Southern Dynasties."))
city("扬州", "Yangzhou", 119.4, 32.4,
     (-486, 588, "广陵", "Guangling", "major", "吴王夫差开邗沟筑城，汉吴国都城。", "Founded with the Han canal; Han kingdom of Wu."),
     (589, 1912, "扬州", "Yangzhou", "major", "运河与长江交汇，唐“扬一益二”，明清盐商之都。", "Canal–Yangtze junction; richest Tang city; salt-merchant capital later."))
city("成都", "Chengdu", 104.07, 30.67,
     (-1150, -651, "金沙", "Jinsha", "capital", "三星堆之后的古蜀中心都邑（今成都西郊金沙遗址），出土太阳神鸟金饰。", "Shu centre after Sanxingdui (Jinsha site, west Chengdu), known for its sun-bird gold foil."),
     (-650, -317, "成都", "Chengdu", "capital", "古蜀国都城：杜宇都郫，开明氏徙治成都（年代不详，均在成都平原）。", "Capital of the ancient state of Shu (the Kaiming kings moved here from Pi; dates uncertain)."),
     (-316, 220, "成都", "Chengdu", "major", "秦灭蜀后筑城，汉代五大都会之一。", "One of the five great cities of Han."),
     (221, 263, "成都", "Chengdu", "capital", "蜀汉都城。", "Capital of Shu-Han."),
     (264, 906, "成都", "Chengdu", "major", "唐“扬一益二”，安史之乱时玄宗避难于此。", "Second city of Tang; refuge of Xuanzong in 756."),
     (907, 965, "成都", "Chengdu", "capital", "前蜀、后蜀都城。", "Capital of Former and Later Shu."),
     (966, 1912, "成都", "Chengdu", "major", "北宋发行交子，世界最早纸币。", "Where the first paper money, jiaozi, was issued."))
city("重庆", "Chongqing", 106.55, 29.56,
     (-700, -317, "江州", "Jiangzhou", "capital", "巴国都邑之一（巴都屡迁，江州为其一）。", "A seat of the state of Ba (Ba moved its capital several times)."),
     (-316, 1188, "江州", "Jiangzhou (Yu)", "major", "巴郡治所，后称渝州。", "Seat of Ba commandery, later Yuzhou."),
     (1189, 1912, "重庆", "Chongqing", "major", "南宋抗蒙山城防御中心（钓鱼城）。", "Centre of Song mountain-fort resistance to the Mongols."))
city("广州", "Guangzhou", 113.26, 23.13,
     (-214, -111, "番禺", "Panyu", "capital", "南越国都城。", "Capital of Nanyue."),
     (-110, 916, "番禺", "Panyu (Guangzhou)", "port", "南海郡治，唐代设市舶使，阿拉伯商人云集。", "Southern port; Tang trade office and Arab merchant quarter."),
     (917, 971, "兴王府", "Xingwang", "capital", "南汉都城。", "Capital of Southern Han."),
     (972, 1912, "广州", "Guangzhou", "port", "清代一口通商（十三行）。", "Qing's only open port for Western trade (Thirteen Factories)."))
city("泉州", "Quanzhou", 118.59, 24.91,
     (1087, 1450, "泉州", "Quanzhou (Zayton)", "port", "宋元东方第一大港，马可·波罗称刺桐。", "Largest port of the Song–Yuan world, Marco Polo's Zayton."))
city("宁波", "Ningbo", 121.55, 29.87,
     (738, 1912, "明州", "Mingzhou (Ningbo)", "port", "对日本、高丽贸易港，明代勘合贸易口岸；1842年开埠。", "Port for Japan and Korea; treaty port 1842."))
city("福州", "Fuzhou", 119.3, 26.08,
     (-202, 1912, "福州", "Fuzhou", "port", "闽越都城东冶，后为福建首府，船政局所在。", "Old Minyue capital; Fujian's capital and naval yard."))
city("武汉", "Wuhan", 114.3, 30.55,
     (208, 588, "夏口", "Xiakou", "frontier", "长江与汉水交汇处的军港，孙吴江夏重镇。", "Naval base where the Han meets the Yangtze."),
     (589, 1912, "武昌", "Wuchang (Ezhou)", "major", "鄂州、武昌府，湖广首府；1911年武昌起义。", "Capital of Huguang; Wuchang Uprising of 1911."))
city("襄阳", "Xiangyang", 112.14, 32.04,
     (190, 1912, "襄阳", "Xiangyang", "frontier", "南北必争之地，宋元襄樊之战六年。", "Key of north–south war; besieged six years by the Mongols."))
city("长沙", "Changsha", 112.94, 28.23,
     (-202, 1912, "长沙", "Changsha", "major", "汉长沙国（马王堆）、五代楚国都城、湖南省城。", "Han kingdom of Changsha (Mawangdui); Chu capital in the Five Dynasties."))
city("南昌", "Nanchang", 115.89, 28.68,
     (-202, 1912, "豫章", "Yuzhang (Hongzhou)", "major", "江西首府，滕王阁所在。", "Capital of Jiangxi, home of the Tengwang Pavilion."))
city("合肥", "Hefei", 117.27, 31.86,
     (200, 280, "合肥", "Hefei", "frontier", "曹魏对吴前线，张辽逍遥津之战，孙权多次攻而不克。", "Wei frontier fortress; Sun Quan failed to take it again and again."),
     (1128, 1279, "庐州", "Luzhou (Hefei)", "frontier", "南宋两淮防线要地。", "Southern Song stronghold on the Huai front."))
city("寿县", "Shouxian", 116.79, 32.57,
     (-241, -223, "寿春", "Shouchun", "capital", "楚国最后都城。", "Last capital of Chu."),
     (-222, 960, "寿春", "Shouchun", "frontier", "淮南重镇，淝水之战前线。", "Huainan stronghold near the Fei River battlefield."))
city("徐州", "Xuzhou", 117.18, 34.26,
     (-206, 1912, "彭城", "Pengcheng (Xuzhou)", "major", "西楚霸王项羽都城，兵家必争之地。", "Xiang Yu's capital; a battleground of every age."))
city("许昌", "Xuchang", 113.85, 34.04,
     (196, 220, "许", "Xu", "capital", "曹操迎汉献帝都许。", "Cao Cao moved the last Han emperor here."))
city("太原", "Taiyuan", 112.55, 37.87,
     (-497, 979, "晋阳", "Jinyang", "major", "李渊起兵之地，唐北都，五代沙陀根据地。", "Where Li Yuan rose; Tang northern capital; Shatuo base."),
     (980, 1912, "太原", "Taiyuan", "major", "宋灭北汉后毁晋阳另筑新城，山西省城。", "Rebuilt after Song razed Jinyang; Shanxi capital."))
city("大同", "Datong", 113.3, 40.08,
     (398, 493, "平城", "Pingcheng", "capital", "北魏前期都城，近郊有云冈石窟。", "Northern Wei capital; Yungang caves nearby."),
     (1044, 1122, "西京", "Western Capital (Liao)", "secondary", "辽西京大同府。", "Liao western capital."),
     (1369, 1912, "大同", "Datong", "frontier", "明九边重镇。", "One of Ming's Nine Frontier Garrisons."))
city("呼和浩特", "Hohhot", 111.67, 40.82,
     (1572, 1912, "归化城", "Guihua", "frontier", "阿勒坦汗所筑，蒙汉互市中心。", "Built by Altan Khan; Mongol–Chinese trade town."))
city("榆林", "Yulin", 109.73, 38.29,
     (1472, 1912, "榆林", "Yulin", "frontier", "明延绥镇治所，九边之一。", "Ming frontier garrison."))
city("银川", "Yinchuan", 106.23, 38.49,
     (1038, 1227, "兴庆", "Xingqing", "capital", "西夏都城。", "Capital of Western Xia."),
     (1228, 1912, "宁夏", "Ningxia", "frontier", "明九边宁夏镇。", "Ming frontier garrison."))
city("兰州", "Lanzhou", 103.83, 36.06,
     (-81, 1912, "金城", "Jincheng (Lanzhou)", "frontier", "黄河渡口，河西走廊门户。", "Yellow River crossing at the gate of the Hexi Corridor."))
city("武威", "Wuwei", 102.64, 37.93,
     (-104, 1912, "姑臧", "Guzang (Liangzhou)", "frontier", "凉州治所，五凉都城，河西第一大城。", "Seat of Liangzhou; largest city of the Hexi Corridor."))
city("张掖", "Zhangye", 100.45, 38.93,
     (-104, 1912, "张掖", "Zhangye (Ganzhou)", "frontier", "河西四郡之一，隋炀帝在此会见西域诸国。", "One of the four Hexi commanderies."))
city("酒泉", "Jiuquan", 98.5, 39.73,
     (-104, 1912, "酒泉", "Jiuquan (Suzhou)", "frontier", "河西四郡之一，近嘉峪关。", "One of the four Hexi commanderies, near Jiayu Pass."))
city("敦煌", "Dunhuang", 94.66, 40.14,
     (-111, 1912, "敦煌", "Dunhuang (Shazhou)", "frontier", "丝路咽喉，莫高窟所在。", "Silk Road gateway, home of the Mogao caves."))
city("吐鲁番", "Turpan", 89.19, 42.95,
     (-60, 640, "高昌", "Gaochang", "capital", "高昌国都城，640年为唐所灭。", "Capital of Gaochang, conquered by Tang in 640."),
     (640, 1912, "西州", "Xizhou (Turpan)", "frontier", "唐西州，后为回鹘高昌、吐鲁番。", "Tang Xizhou, later Uyghur Qocho."))
city("库车", "Kuqa", 82.96, 41.72,
     (-200, 1000, "龟兹", "Kucha", "frontier", "西域大国，唐安西都护府治所，鸠摩罗什故乡。", "Great oasis kingdom; seat of the Tang Anxi Protectorate."))
city("喀什", "Kashgar", 75.99, 39.47,
     (-200, 1912, "疏勒", "Kashgar", "frontier", "塔里木西缘绿洲，唐安西四镇之一。", "Western Tarim oasis; one of Tang's Four Garrisons."))
city("和田", "Hotan", 79.92, 37.11,
     (-200, 1006, "于阗", "Khotan", "frontier", "玉石之国，安西四镇之一。", "Kingdom of jade; one of Tang's Four Garrisons."))
city("乌鲁木齐", "Ürümqi", 87.62, 43.83,
     (1763, 1912, "迪化", "Dihua", "frontier", "清代新疆重镇，1884年新疆建省后为省城。", "Qing city; capital of Xinjiang province from 1884."))
city("伊宁", "Yining", 81.3, 43.92,
     (1764, 1912, "惠远", "Huiyuan (Ili)", "frontier", "伊犁将军驻地，清代新疆军政中心。", "Seat of the Ili General."))
city("吉木萨尔", "Jimsar", 89.18, 44.0,
     (702, 790, "庭州", "Tingzhou (Beiting)", "frontier", "唐北庭都护府治所。", "Seat of the Tang Beiting Protectorate."))
city("拉萨", "Lhasa", 91.13, 29.65,
     (633, 842, "逻些", "Rasa (Lhasa)", "capital", "吐蕃都城。", "Capital of the Tibetan Empire."),
     (1642, 1912, "拉萨", "Lhasa", "capital", "甘丹颇章政权中心，清驻藏大臣驻地。", "Seat of the Ganden Phodrang and the Qing ambans."))
city("日喀则", "Shigatse", 88.88, 29.27,
     (1447, 1912, "日喀则", "Shigatse", "major", "扎什伦布寺，班禅驻锡地。", "Tashilhunpo monastery, seat of the Panchen Lama."))
city("萨迦", "Sakya", 88.02, 28.9,
     (1264, 1354, "萨迦", "Sakya", "major", "元代萨迦派主政西藏的中心。", "Centre of Sakya rule over Tibet under the Yuan."))
city("西宁", "Xining", 101.78, 36.62,
     (1104, 1912, "西宁", "Xining", "frontier", "河湟重镇，近塔尔寺，清西宁办事大臣驻地。", "Gateway to Amdo; seat of the Qing Xining amban."))
city("大理", "Dali", 100.23, 25.6,
     (738, 778, "太和城", "Taihe", "capital", "南诏都城。", "Capital of Nanzhao."),
     (779, 1253, "羊苴咩城", "Yangjumie", "capital", "南诏、大理国都城。", "Capital of Nanzhao and the Dali kingdom."))
city("昆明", "Kunming", 102.71, 25.04,
     (765, 1253, "拓东城", "Tuodong (Shanchan)", "secondary", "南诏东京、大理国鄯阐府。", "Eastern capital of Nanzhao and Dali."),
     (1276, 1912, "昆明", "Kunming", "major", "元以后云南省城。", "Capital of Yunnan from the Yuan."))
city("贵阳", "Guiyang", 106.71, 26.58,
     (1413, 1912, "贵阳", "Guiyang", "major", "明设贵州布政使司后的省城。", "Capital of Guizhou province from 1413."))
city("桂林", "Guilin", 110.29, 25.27,
     (-214, 1912, "桂林", "Guilin (Shi'an)", "major", "灵渠沟通湘漓，岭南西部重镇。", "Linked to the Yangtze by the Lingqu canal."))
city("南宁", "Nanning", 108.37, 22.82,
     (1000, 1912, "邕州", "Yongzhou (Nanning)", "frontier", "宋代对交趾、侬智高战事前线。", "Song frontier against Đại Việt and Nong Zhigao."))
city("海口", "Haikou", 110.35, 20.02,
     (-110, 1912, "琼州", "Qiongzhou", "frontier", "海南岛治所，苏轼曾谪居儋州。", "Seat of Hainan island."))
city("越南河内", "Hanoi", 105.85, 21.03,
     (-110, 938, "交州", "Jiaozhou", "frontier", "汉唐交趾郡、安南都护府治所。", "Han–Tang Jiaozhi; seat of the Annan Protectorate."),
     (1010, 1912, "升龙", "Thăng Long", "capital", "越南李、陈、黎朝都城。", "Capital of Vietnam's Lý, Trần and Lê dynasties."))
city("朝鲜平壤", "Pyongyang", 125.75, 39.02,
     (-108, 313, "乐浪", "Lelang", "frontier", "汉乐浪郡治。", "Seat of the Han Lelang commandery."),
     (427, 668, "平壤", "Pyongyang", "capital", "高句丽后期都城。", "Late Goguryeo capital."))
city("集安", "Ji'an", 126.19, 41.13,
     (3, 427, "国内城", "Gungnae", "capital", "高句丽都城，好太王碑所在。", "Goguryeo capital, site of the Gwanggaeto stele."))
city("开城", "Kaesong", 126.55, 37.97,
     (919, 1392, "开京", "Kaegyong", "capital", "高丽王朝都城。", "Capital of Goryeo."))
city("首尔", "Seoul", 126.98, 37.57,
     (1394, 1912, "汉城", "Hanseong", "capital", "朝鲜王朝都城。", "Capital of Joseon."))
city("庆州", "Gyeongju", 129.21, 35.86,
     (-57, 935, "金城", "Geumseong", "capital", "新罗都城。", "Capital of Silla."))
city("奈良", "Nara", 135.8, 34.68,
     (710, 784, "平城京", "Heijō-kyō", "capital", "日本奈良时代都城，仿长安。", "Japan's Nara-period capital, modelled on Chang'an."))
city("京都", "Kyoto", 135.77, 35.01,
     (794, 1868, "平安京", "Heian-kyō", "capital", "日本千年古都。", "Japan's capital for a thousand years."))
city("江户", "Tokyo", 139.69, 35.69,
     (1603, 1912, "江户", "Edo", "capital", "德川幕府所在，1868年改称东京。", "Seat of the Tokugawa shogunate; renamed Tokyo in 1868."))
city("巴林左旗", "Bairin Left", 119.38, 43.98,
     (918, 1120, "上京", "Shangjing (Liao)", "capital", "辽上京临潢府。", "Liao supreme capital."))
city("宁城", "Ningcheng", 119.2, 41.6,
     (1007, 1120, "中京", "Zhongjing (Liao)", "secondary", "辽中京大定府。", "Liao central capital."))
city("辽阳", "Liaoyang", 123.17, 41.27,
     (-300, 1621, "辽阳", "Liaoyang (Xiangping)", "major", "辽东郡治，辽东京，明辽东都司治所。", "Seat of Liaodong; Liao eastern capital; Ming Liaodong command."))
city("哈尔滨阿城", "Acheng", 126.97, 45.53,
     (1115, 1153, "上京", "Shangjing (Jin)", "capital", "金上京会宁府。", "Jin supreme capital."))
city("沈阳", "Shenyang", 123.43, 41.8,
     (1625, 1643, "盛京", "Mukden", "capital", "后金、清入关前都城。", "Later Jin / Qing capital before 1644."),
     (1644, 1912, "盛京", "Mukden", "secondary", "清陪都，留都盛京。", "Qing secondary capital."))
city("赫图阿拉", "Hetu Ala", 124.85, 41.7,
     (1616, 1621, "赫图阿拉", "Hetu Ala", "capital", "努尔哈赤建后金之地。", "Where Nurhaci founded Later Jin."))
city("锦州", "Jinzhou", 121.13, 41.1,
     (1400, 1642, "锦州", "Jinzhou", "frontier", "明辽西重镇，1642年松锦之战后失守。", "Ming stronghold of western Liaodong, lost in 1642."))
city("哈拉和林", "Karakorum", 102.83, 47.2,
     (1235, 1260, "哈拉和林", "Karakorum", "capital", "蒙古帝国都城。", "Capital of the Mongol Empire."))
city("正蓝旗", "Zhenglan Banner", 116.18, 42.36,
     (1263, 1368, "上都", "Shangdu (Xanadu)", "secondary", "元夏都开平，忽必烈即位之地。", "Yuan summer capital, Xanadu."))
city("承德", "Chengde", 117.94, 40.95,
     (1703, 1912, "热河", "Rehe (Chengde)", "secondary", "避暑山庄，清帝夏宫。", "Qing summer palace."))
city("天津", "Tianjin", 117.2, 39.13,
     (1404, 1912, "天津", "Tianjin", "port", "明设天津卫，运河与海运枢纽；1860年开埠。", "Ming garrison at the canal mouth; treaty port 1860."))
city("济南", "Jinan", 117.0, 36.67,
     (-150, 1912, "历城", "Licheng (Jinan)", "major", "齐州、济南府，明清山东省城。", "Capital of Shandong."))
city("临清", "Linqing", 115.7, 36.84,
     (1411, 1850, "临清", "Linqing", "major", "明清运河商城，“富庶甲齐郡”。", "Grand Canal trade city."))
city("淮安", "Huai'an", 119.02, 33.6,
     (400, 1912, "山阳", "Shanyang (Huai'an)", "major", "运河与淮河交汇，明清漕运总督驻地。", "Canal–Huai junction; seat of the Grain Transport Viceroy."))
city("景德镇", "Jingdezhen", 117.18, 29.27,
     (1004, 1912, "景德镇", "Jingdezhen", "major", "瓷都，宋景德年间得名。", "The porcelain capital."))
city("上海", "Shanghai", 121.47, 31.23,
     (1292, 1842, "上海", "Shanghai", "major", "元设上海县，松江棉布贸易港。", "County port of the cotton trade."),
     (1843, 1912, "上海", "Shanghai", "port", "1843年开埠，远东最大商埠。", "Treaty port from 1843, largest in East Asia."))
city("香港", "Hong Kong", 114.17, 22.28,
     (1842, 1912, "香港", "Hong Kong", "port", "1842年割让英国。", "Ceded to Britain in 1842."))
city("澳门", "Macau", 113.54, 22.2,
     (1557, 1912, "澳门", "Macau", "port", "1557年葡萄牙人入居。", "Portuguese settlement from 1557."))
city("厦门", "Xiamen", 118.09, 24.48,
     (1650, 1912, "厦门", "Xiamen (Amoy)", "port", "郑成功根据地，1843年开埠。", "Zheng Chenggong's base; treaty port 1843."))
city("台南", "Tainan", 120.2, 23.0,
     (1624, 1912, "台湾府", "Tainan (Zeelandia)", "port", "荷兰热兰遮城，郑氏东宁、清台湾府治。", "Dutch Fort Zeelandia; Zheng capital; Qing seat of Taiwan."))
city("汉中", "Hanzhong", 107.02, 33.07,
     (-312, -207, "南郑", "Nanzheng", "frontier", "秦汉中郡治，扼秦岭与巴蜀之间。", "Seat of Qin's Hanzhong commandery, between the Qinling and Sichuan."),
     (-206, -202, "南郑", "Nanzheng", "capital", "刘邦受封汉王，以此为都，“汉”之国号由此而来。", "Liu Bang's capital as King of Han, the origin of the dynasty's name."),
     (-201, 190, "汉中", "Hanzhong", "frontier", "汉中郡，关中与巴蜀之间的门户。", "Hanzhong commandery, the gate between Guanzhong and Sichuan."),
     (191, 215, "汉中", "Hanzhong", "capital", "张鲁五斗米道政权据此近三十年，215年降曹操。", "Zhang Lu's Daoist state for 25 years, until he surrendered to Cao Cao in 215."),
     (216, 263, "汉中", "Hanzhong", "frontier", "219年刘备夺汉中称汉中王；诸葛亮、姜维以此为北伐基地，魏延“实兵诸围”拒守。", "Liu Bei took it in 219; base of Zhuge Liang's and Jiang Wei's northern campaigns."),
     (264, 1129, "汉中", "Hanzhong (Liangzhou)", "frontier", "梁州/兴元府，川陕之间的要冲。", "Liangzhou / Xingyuan, the key between Shaanxi and Sichuan."),
     (1130, 1279, "兴元", "Xingyuan (Hanzhong)", "frontier", "南宋川陕防线核心，与金、蒙古反复争夺。", "Core of the Southern Song Sichuan–Shaanxi defence."),
     (1280, 1912, "汉中", "Hanzhong", "frontier", "明清汉中府，陕南重镇。", "Ming–Qing prefecture of southern Shaanxi."))
city("天水", "Tianshui", 105.72, 34.58,
     (-688, 1912, "上邽", "Shanggui (Qinzhou)", "frontier", "陇右重镇，诸葛亮北伐争夺之地。", "Key town of Longyou, fought over in Zhuge Liang's campaigns."))
city("固原", "Guyuan", 106.28, 36.0,
     (-114, 1912, "高平", "Gaoping (Yuanzhou)", "frontier", "萧关所在，丝路东段要冲，明三边总制驻地。", "Guards Xiao Pass; Ming frontier command."))
city("宣化", "Xuanhua", 115.06, 40.61,
     (1393, 1912, "宣府", "Xuanfu", "frontier", "明九边之首，拱卫京师。", "Chief of the Ming frontier garrisons, shielding Beijing."))
city("蓟县", "Jixian", 117.4, 40.04,
     (1550, 1644, "蓟州", "Jizhou", "frontier", "明蓟镇，戚继光镇守。", "Ming Ji garrison held by Qi Jiguang."))
city("宁波双屿", "Shuangyu", 122.1, 29.85,
     (1525, 1548, "双屿", "Shuangyu", "port", "明代走私贸易港，葡萄牙人聚居，1548年被毁。", "Smuggling port with Portuguese traders, destroyed 1548."))
city("南阳", "Nanyang", 112.53, 33.0,
     (-800, -688, "申", "Shen", "capital", "申国都城，周宣王所封，后为楚所灭。", "Capital of Shen, annexed by Chu."),
     (-272, 1912, "宛", "Wan (Nanyang)", "major", "冶铁重镇，汉代五大都会之一，光武帝起兵之地。", "Iron-working centre, one of the five great cities of Han."))
city("定陶", "Dingtao", 115.57, 35.07,
     (-480, -100, "陶", "Tao", "major", "“天下之中”，范蠡经商致富之地。", "'Centre of the world', where Fan Li grew rich in trade."))
city("镇江", "Zhenjiang", 119.45, 32.2,
     (209, 1912, "京口", "Jingkou (Zhenjiang)", "major", "长江渡口，东晋北府兵驻地。", "Yangtze crossing; base of the Northern Garrison army."))
city("九江", "Jiujiang", 116.0, 29.7,
     (-201, 1912, "浔阳", "Xunyang (Jiangzhou)", "major", "长江中游要津，白居易《琵琶行》作于此。", "Middle Yangtze port of Bai Juyi's 'Pipa Song'."))
city("广汉", "Guanghan", 104.2, 31.0,
     (-1700, -1150, "三星堆", "Sanxingdui", "capital", "古蜀国都邑，出土青铜纵目面具。", "Ancient Shu city, famous for its bronze masks."))
city("黄陂", "Huangpi", 114.27, 30.69,
     (-1500, -1300, "盘龙城", "Panlongcheng", "frontier", "商朝南方据点，控制长江铜料。", "Shang southern outpost controlling Yangtze copper."))
city("汉口", "Hankou", 114.28, 30.58,
     (1861, 1912, "汉口", "Hankou", "port", "清末开埠，“九省通衢”。", "Treaty port and inland trade hub."))
# Military strongholds (军事重镇), by period.
city("鄂州", "Ezhou", 114.89, 30.39,
     (221, 229, "武昌", "Wuchang (Wu)", "capital", "孙权由公安迁此，改鄂县为武昌并称帝，229年迁建业。", "Sun Quan's capital until 229."),
     (230, 280, "武昌", "Wuchang (Wu)", "frontier", "孙吴长江中游军事中心。", "Wu's military centre on the middle Yangtze."))
city("宜昌", "Yichang", 111.29, 30.7,
     (208, 280, "夷陵", "Yiling", "frontier", "蜀吴交界，222年陆逊火烧连营大败刘备。", "Shu–Wu border; Lu Xun routed Liu Bei here in 222."))
city("奉节", "Fengjie", 109.57, 31.04,
     (25, 280, "白帝城", "Baidicheng", "frontier", "扼瞿塘峡口，223年刘备托孤于此。", "Guards the Qutang gorge; Liu Bei died here in 223."))
city("宝鸡陈仓", "Chencang", 107.15, 34.35,
     (-206, 300, "陈仓", "Chencang", "frontier", "“暗度陈仓”；228年郝昭以千余人拒诸葛亮。", "'Secretly crossing at Chencang'; held against Zhuge Liang in 228."))
city("礼县", "Lixian", 105.18, 34.18,
     (220, 263, "祁山", "Qishan", "frontier", "诸葛亮北伐屡出祁山，攻取陇右的要道。", "Zhuge Liang's route into Longyou."))
city("房县", "Fangxian", 110.73, 32.05,
     (219, 280, "新城", "Xincheng (Fangling)", "frontier", "魏蜀吴三方交界，228年孟达反魏被司马懿速平。", "Three-way border; Meng Da's revolt crushed by Sima Yi in 228."))
city("无为", "Wuwei", 117.85, 31.6,
     (212, 280, "濡须口", "Ruxu", "frontier", "孙吴筑坞抗曹魏，曹操叹“生子当如孙仲谋”。", "Wu fort against Wei; 'a son should be like Sun Quan'."))
city("樊城", "Fancheng", 112.15, 32.08,
     (190, 1279, "樊城", "Fancheng", "frontier", "与襄阳隔汉水相望，219年关羽水淹七军。", "Facing Xiangyang over the Han River; Guan Yu's flood victory of 219."))
city("包头", "Baotou", 109.85, 40.58,
     (-221, 220, "九原", "Jiuyuan", "frontier", "秦直道终点，北御匈奴。", "End of the Qin Straight Road, facing the Xiongnu."))
city("托克托", "Togtoh", 111.2, 40.3,
     (-300, 220, "云中", "Yunzhong", "frontier", "赵武灵王所置，汉北边重镇。", "Northern frontier commandery since King Wuling of Zhao."))
city("朔州", "Shuozhou", 112.43, 39.33,
     (-214, 600, "马邑", "Mayi", "frontier", "雁门郡要地，前133年马邑之谋。", "Frontier town of the Mayi ambush of 133 BCE."))
city("额济纳", "Ejin", 101.1, 41.9,
     (-102, 200, "居延", "Juyan", "frontier", "汉代居延塞，出土大量汉简。", "Han frontier fort, source of the Juyan bamboo slips."))
city("汝南", "Runan", 114.36, 33.0,
     (420, 589, "悬瓠", "Xuanhu", "frontier", "南北朝淮北争夺要地。", "Fought over by the Northern and Southern Dynasties."))
city("凤阳临淮", "Zhongli", 117.5, 32.9,
     (420, 589, "钟离", "Zhongli", "frontier", "507年梁军在此大破北魏。", "Liang's great victory over Northern Wei in 507."))
city("稷山", "Jishan", 110.95, 35.6,
     (542, 577, "玉璧", "Yubi", "frontier", "西魏韦孝宽据守，546年高欢围攻五十日不克。", "Wei Xiaokuan held it against Gao Huan's 50-day siege in 546."))
city("固阳", "Guyang", 110.1, 41.0,
     (430, 534, "怀朔镇", "Huaishuo", "frontier", "北魏六镇之一，高欢出身于此。", "One of the Six Garrisons; Gao Huan's home."))
city("武川", "Wuchuan", 111.45, 41.1,
     (430, 534, "武川镇", "Wuchuan", "frontier", "北魏六镇之一，宇文泰、杨忠、李虎出身于此。", "One of the Six Garrisons; home of the Yuwen, Yang and Li founders."))
city("灵武", "Lingwu", 106.3, 38.1,
     (618, 1002, "灵州", "Lingzhou", "frontier", "朔方节度使治所，756年唐肃宗在此即位。", "Seat of the Shuofang army; Suzong took the throne here in 756."))
city("巴彦淖尔", "Bayannur", 108.0, 40.75,
     (708, 900, "受降城", "Shouxiang Cities", "frontier", "张仁愿筑三受降城，控制河套。", "Three forts built in 708 to hold the Ordos loop."))
city("永济", "Yongji", 110.38, 34.83,
     (618, 960, "蒲州", "Puzhou (Hezhong)", "frontier", "河中府，扼蒲津渡，拱卫长安。", "Guards the Pujin crossing and Chang'an."))
city("长治", "Changzhi", 113.1, 36.2,
     (-262, 1912, "上党", "Shangdang (Luzhou)", "frontier", "“得上党者得天下”，长平之战、昭义镇所在。", "'Who holds Shangdang holds the realm'; Changping battle nearby."))
city("吉尔吉斯托克马克", "Tokmok", 75.3, 42.8,
     (679, 719, "碎叶", "Suyab", "frontier", "唐安西四镇之一，最西的唐城。", "Westernmost Tang garrison."))
city("雄县", "Xiongxian", 116.1, 38.99,
     (960, 1127, "雄州", "Xiongzhou", "frontier", "宋辽边界，白沟河榷场。", "Song–Liao border town and market."))
city("定州", "Dingzhou", 115.0, 38.5,
     (-414, -381, "顾", "Gu", "capital", "中山国早期都城。", "Early capital of Zhongshan."),
     (960, 1127, "定州", "Dingzhou", "frontier", "宋河北边防重镇，设塘泊防线。", "Song frontier base behind the water defences."))
city("延安", "Yan'an", 109.49, 36.6,
     (1000, 1127, "延州", "Yanzhou", "frontier", "宋夏前线，范仲淹镇守。", "Song–Xia front, held by Fan Zhongyan."))
city("合川", "Hechuan", 106.28, 30.0,
     (1243, 1279, "钓鱼城", "Diaoyu Fortress", "frontier", "南宋山城，1259年蒙哥汗死于城下。", "Song hill fort; Möngke Khan died before it in 1259."))
city("偏关", "Pianguan", 111.5, 39.43,
     (1390, 1644, "偏头关", "Piantou Pass", "frontier", "明山西镇（偏头关），九边之一。", "Ming Shanxi garrison, one of the Nine Frontiers."))
city("乌里雅苏台", "Uliastai", 96.85, 47.73,
     (1733, 1912, "乌里雅苏台", "Uliastai", "frontier", "清定边左副将军驻地，统辖喀尔喀。", "Seat of the Qing general over Khalkha Mongolia."))
city("科布多", "Khovd", 91.64, 48.0,
     (1762, 1912, "科布多", "Khovd", "frontier", "清科布多参赞大臣驻地。", "Seat of the Qing Khovd amban."))
city("黑河", "Heihe", 127.5, 50.25,
     (1683, 1912, "瑷珲", "Aigun", "frontier", "黑龙江将军初驻地，1858年《瑷珲条约》。", "First seat of the Heilongjiang general; 1858 treaty."))
city("宁安", "Ning'an", 129.47, 44.35,
     (1666, 1912, "宁古塔", "Ningguta", "frontier", "宁古塔将军驻地，清流放之地。", "Seat of the Ningguta general; place of exile."))
city("吉林", "Jilin", 126.55, 43.85,
     (1676, 1912, "吉林乌拉", "Jilin Ula", "frontier", "吉林将军驻地，松花江船厂。", "Seat of the Jilin general and shipyard."))

city("翼城", "Yicheng", 111.72, 35.74,
     (-770, -586, "绛", "Jiang (Yi)", "capital", "晋国都城（翼，后称绛），前585年迁新田。", "Capital of Jin until the move to Xintian in 585 BCE."))
city("淇县", "Qixian", 114.2, 35.6,
     (-1040, -661, "朝歌", "Zhaoge", "capital", "商末都邑，后为卫国都城，前660年为狄所破。", "Late Shang seat, then capital of Wey until the Di sacked it in 660 BCE."))
city("滑县", "Huaxian", 114.52, 35.58,
     (-658, -630, "楚丘", "Chuqiu", "capital", "齐桓公助卫复国所筑新都。", "Wey's capital rebuilt with Qi's help."))
city("濮阳", "Puyang", 115.03, 35.76,
     (-629, -209, "帝丘", "Diqiu", "capital", "卫国后期都城。", "Later capital of Wey."))
city("淅川", "Xichuan", 111.49, 33.1,
     (-1000, -690, "丹阳", "Danyang", "capital", "楚国早期都城（地望有争议，此取丹淅之会说）。", "Early Chu capital (location disputed; placed at the Dan–Xi confluence)."))
city("礼县", "Lixian", 105.17, 34.19,
     (-850, -763, "西垂", "Xichui", "capital", "秦人早期居邑（西犬丘），大堡子山秦公墓所在。", "Early Qin seat; Qin dukes' tombs at Dabuzishan."))
city("宝鸡陈仓", "Chencang (Baoji)", 107.3, 34.37,
     (-762, -678, "平阳", "Pingyang", "capital", "秦文公居汧渭之会，宪公迁平阳，前677年迁雍。", "Qin seat near the Qian–Wei confluence, then Pingyang, before Yong."))
city("上蔡", "Shangcai", 114.26, 33.26,
     (-1040, -532, "上蔡", "Shangcai", "capital", "蔡国都城，前531年为楚所灭，后复国迁新蔡。", "Capital of Cai until Chu took it in 531 BCE."))
city("新蔡", "Xincai", 114.98, 32.75,
     (-529, -494, "新蔡", "Xincai", "capital", "蔡平侯复国后都城。", "Cai's capital after it was restored."))
city("凤台", "Fengtai", 116.7, 32.7,
     (-493, -447, "下蔡", "Xiacai", "capital", "蔡昭侯迁州来，称下蔡，前447年为楚所灭。", "Cai's last capital, taken by Chu in 447 BCE."))
city("莒县", "Juxian", 118.83, 35.58,
     (-1040, -431, "莒", "Ju", "capital", "莒国都城，前431年为楚所灭。", "Capital of Ju, taken by Chu in 431 BCE."))
city("灵寿", "Lingshou", 114.38, 38.31,
     (-380, -296, "灵寿", "Lingshou", "capital", "中山国都城，前296年为赵所灭。", "Capital of Zhongshan until Zhao conquered it in 296 BCE."))
city("无锡", "Wuxi", 120.42, 31.48,
     (-770, -515, "梅里", "Meili", "capital", "相传泰伯所居，吴国早期都邑（地望有争议）。", "Early Wu seat said to be founded by Taibo (location disputed)."))
city("诸暨", "Zhuji", 120.23, 29.71,
     (-600, -491, "埤中", "Bizhong", "capital", "越国早期都邑（传说在诸暨）。", "Early Yue seat, traditionally placed at Zhuji."))
city("泗洪", "Sihong", 118.2, 33.47,
     (-1000, -512, "徐", "Xu", "capital", "徐国都城，前512年为吴所灭。", "Capital of Xu, conquered by Wu in 512 BCE."))
city("邢台", "Xingtai", 114.5, 37.07,
     (-1040, -662, "邢", "Xing", "capital", "邢国都城，前661年为狄所破，迁夷仪。", "Capital of Xing until the Di sacked it in 661 BCE."))
city("三门峡", "Sanmenxia", 111.2, 34.78,
     (-770, -655, "上阳", "Shangyang", "capital", "虢国都城，前655年晋假道伐虢而灭。", "Capital of Guo, destroyed by Jin in 655 BCE."))
city("随州", "Suizhou", 113.37, 31.69,
     (-1000, -450, "随", "Sui (Zeng)", "capital", "随（曾）国都邑，出土曾侯乙编钟。", "Seat of Sui (Zeng); Marquis Yi of Zeng's bells found nearby."))
city("潢川", "Huangchuan", 115.05, 32.13,
     (-1000, -648, "黄", "Huang", "capital", "黄国都城，前648年为楚所灭。", "Capital of Huang, taken by Chu in 648 BCE."))
city("龙口", "Longkou", 120.5, 37.65,
     (-1000, -567, "莱", "Lai", "capital", "莱国都邑，前567年为齐所灭。", "Seat of Lai, conquered by Qi in 567 BCE."))
city("竹山", "Zhushan", 110.23, 32.23,
     (-1000, -611, "上庸", "Shangyong", "capital", "庸国都城，前611年为楚所灭。", "Capital of Yong, taken by Chu in 611 BCE."))

out = []
for modern_zh, modern, lon, lat, spans in C:
    for i, (a, b, zh, en, rank, nz, ne) in enumerate(spans):
        if not zh:
            continue
        out.append({"id": f"{modern.lower().replace(' ', '-').replace(chr(39), '')}-{i}", "name": en, "name_zh": zh,
                    "modern": modern, "modern_zh": modern_zh, "lon": lon, "lat": lat, "rank": rank,
                    "from": a, "to": b, "note": ne, "note_zh": nz})
json.dump(out, open("data/places.json", "w"), ensure_ascii=False, indent=0)
print(len(out), "entries,", len(C), "cities")
