/* Liar Game — word lists and the hint helpers shared by the engine and the screen.
   Every category has ~16 words; every word is bilingual and carries 5 bilingual hints that AI citizens give.
   `vague` hints fit the whole category: the liar AI (who only knows the category) uses them, and so does a timed-out player.
   Rules the data must follow (checked by games/liar/test_words.mjs):
   - Korean words have at least two syllables (a one-syllable word would block far too many hints);
   - no hint contains its own word, no vague hint contains any word of its category, no universal hint contains any word;
   - Korean hints are at most 14 characters, English hints at most 24. */
import { tx } from "../../core/i18n.js";

export const MAX_HINT = 14;        // characters a person may type
export const MAX_AI_KO = 14, MAX_AI_EN = 24;

const pair = s => { const [ko, en] = s.split("|"); return tx(ko, en); };
const cat = (id, ko, en, icon, vague, words) => ({
  id, name: tx(ko, en), icon, vague: vague.map(pair),
  words: words.map(([wk, we, ...h]) => ({ w: tx(wk, we), h: h.map(pair) }))
});

export const CATS = [
  cat("food", "음식", "Food", "🍲",
    ["맛있다|Tasty", "자주 먹어요|I eat it often", "배고플 때|When I'm hungry", "식당|Restaurants", "한 그릇|One serving",
      "저녁 메뉴|Dinner idea", "냄새가 좋다|Smells good", "인기 많음|Very popular"], [
      ["피자", "Pizza", "치즈|Cheese", "동그랗다|Round", "배달|Delivery", "조각|Slices", "이탈리아|Italy"],
      ["김치찌개", "Kimchi stew", "얼큰하다|Spicy", "뚝배기|Clay pot", "돼지고기|Pork", "빨간 국물|Red broth", "밥도둑|Goes with rice"],
      ["비빔밥", "Bibimbap", "고추장|Chili paste", "나물|Veggies", "섞다|Mix it up", "계란 프라이|Fried egg on top", "전주|Jeonju"],
      ["떡볶이", "Tteokbokki", "분식|Street food", "쫄깃함|Chewy", "어묵|Fish cake", "매콤달콤|Sweet and spicy", "학교 앞|Near school"],
      ["라면", "Ramen", "꼬불꼬불|Curly", "3분|Three minutes", "봉지|In a packet", "끓이다|Boil it", "야식|Late-night snack"],
      ["햄버거", "Hamburger", "패티|Patty", "빵 사이|Between buns", "패스트푸드|Fast food", "감자튀김|With fries", "케첩|Ketchup"],
      ["초밥", "Sushi", "생선|Raw fish", "일본|Japan", "와사비|Wasabi", "밥 한 입|A bite of rice", "회전|Conveyor belt"],
      ["짜장면", "Jjajangmyeon", "검은 소스|Black sauce", "중국집|Chinese restaurant", "이삿날|Moving day", "단무지|Pickled radish", "면|Noodles"],
      ["치킨", "Fried chicken", "바삭바삭|Crispy", "닭다리|Drumstick", "양념|Sticky glaze", "반반|Half and half", "튀겼다|Deep-fried"],
      ["김밥", "Gimbap", "소풍|Picnic", "돌돌 말다|Rolled up", "썰어 먹다|Sliced", "도시락|Lunch box", "참기름|Sesame oil"],
      ["삼겹살", "Pork belly", "구워 먹다|Grill it", "상추쌈|Lettuce wrap", "지글지글|Sizzling", "기름|Greasy", "회식|Team dinner"],
      ["아이스크림", "Ice cream", "차갑다|Cold", "녹는다|Melts", "콘|Cone", "여름|Summer", "달콤함|Sweet"],
      ["케이크", "Cake", "생일|Birthday", "촛불|Candles", "생크림|Whipped cream", "자르다|Cut it", "축하|Celebration"],
      ["만두", "Dumplings", "속 재료|Filling", "빚다|Fold by hand", "찜기|Steamer", "설날|Lunar New Year", "한입|One bite"],
      ["불고기", "Bulgogi", "달짝지근|Sweet soy", "소고기|Beef", "간장|Soy sauce", "양념|Marinated", "한식|Korean dish"],
      ["냉면", "Cold noodles", "시원하다|Refreshing", "여름|Summer", "가위|Scissors", "얼음 육수|Icy broth", "평양|Pyongyang"]
    ]),
  cat("animals", "동물", "Animals", "🐾",
    ["귀엽다|Cute", "동물원|At the zoo", "새끼|Babies", "먹이 주기|Feeding time", "다큐멘터리|Documentaries", "야생|In the wild",
      "소리를 낸다|Makes sounds", "그림책|Picture books"], [
      ["고양이", "Cat", "야옹|Meow", "털실|Yarn ball", "츄르|Treats", "그루밍|Grooming", "꾹꾹이|Kneading"],
      ["강아지", "Puppy", "멍멍|Woof", "산책|Walks", "꼬리 흔들기|Wagging tail", "충성|Loyal", "뼈다귀|Bone"],
      ["코끼리", "Elephant", "긴 코|Long trunk", "상아|Ivory tusks", "덩치|Huge", "귀가 크다|Big ears", "아프리카|Africa"],
      ["기린", "Giraffe", "목이 길다|Long neck", "점박이 무늬|Spots", "키다리|Very tall", "나뭇잎|Eats leaves", "초원|Savanna"],
      ["호랑이", "Tiger", "줄무늬|Stripes", "어흥|Roar", "산신령|Mountain spirit", "곶감|Dried persimmon", "백두산|Mt. Baekdu"],
      ["펭귄", "Penguin", "남극|Antarctica", "뒤뚱뒤뚱|Waddle", "턱시도|Tuxedo", "얼음|Ice", "날지 못함|Can't fly"],
      ["토끼", "Rabbit", "당근|Carrots", "깡충깡충|Hop hop", "긴 귀|Long ears", "경주에서 낮잠|Naps during a race", "달나라|On the moon"],
      ["원숭이", "Monkey", "바나나|Bananas", "나무 타기|Climbs trees", "흉내쟁이|Mimic", "서유기|Journey to the West", "긴 꼬리|Long tail"],
      ["돌고래", "Dolphin", "똑똑하다|Smart", "초음파|Echolocation", "바다|Sea", "점프|Jumps", "수족관|Aquarium"],
      ["거북이", "Turtle", "느릿느릿|Slow", "등껍질|Shell", "장수|Long life", "알 낳기|Lays eggs", "별주부전|Korean folk tale"],
      ["판다", "Panda", "대나무|Bamboo", "흑백|Black and white", "중국|China", "푸바오|Fu Bao", "뒹굴뒹굴|Rolls around"],
      ["사자", "Lion", "갈기|Mane", "밀림의 왕|King of the jungle", "초원|Savanna", "무리 생활|Lives in a pride", "심바|Simba"],
      ["캥거루", "Kangaroo", "주머니|Pouch", "호주|Australia", "껑충|Big jumps", "복싱|Boxing", "새끼를 넣다|Carries its baby"],
      ["부엉이", "Owl", "밤|Night", "부엉부엉|Hoot hoot", "지혜|Wisdom", "큰 눈|Big eyes", "고개 돌리기|Turns its head"],
      ["하마", "Hippo", "큰 입|Huge mouth", "강|River", "진흙 목욕|Mud bath", "통통하다|Chubby", "하품|Big yawns"],
      ["낙타", "Camel", "사막|Desert", "혹|Hump", "물 저장|Stores water", "긴 속눈썹|Long lashes", "실크로드|Silk Road"]
    ]),
  cat("places", "장소", "Places", "📍",
    ["사람이 많다|Crowded", "가 봤어요|I've been there", "주말|Weekends", "입장|Entrance", "동네에 있다|In my town",
      "데이트|Date spot", "시간 보내기|Spend time there", "지도|On the map"], [
      ["학교", "School", "선생님|Teachers", "교실|Classroom", "숙제|Homework", "운동장|Playground", "급식|Cafeteria lunch"],
      ["병원", "Hospital", "의사|Doctors", "주사|Shots", "진료|Checkup", "응급실|ER", "입원|Stay overnight"],
      ["도서관", "Library", "조용히|Quiet", "책|Books", "대출|Borrow", "열람실|Reading room", "사서|Librarian"],
      ["놀이공원", "Amusement park", "롤러코스터|Roller coaster", "회전목마|Carousel", "긴 줄|Long lines", "퍼레이드|Parade", "자유이용권|Day pass"],
      ["해변", "Beach", "모래|Sand", "파도|Waves", "수영복|Swimsuit", "여름휴가|Summer vacation", "조개|Seashells"],
      ["영화관", "Movie theater", "팝콘|Popcorn", "큰 화면|Big screen", "예매|Tickets", "어둡다|Dark", "좌석|Seats"],
      ["공항", "Airport", "여권|Passport", "탑승|Boarding", "면세점|Duty free", "캐리어|Suitcase", "출국|Departures"],
      ["편의점", "Convenience store", "24시간|Open 24 hours", "삼각김밥|Rice triangle", "1+1|Buy one get one", "계산대|Counter", "골목|Around the corner"],
      ["지하철역", "Subway station", "개찰구|Turnstiles", "환승|Transfer", "교통카드|Transit card", "출근길|Rush hour", "노선도|Route map"],
      ["수영장", "Swimming pool", "물안경|Goggles", "수영모|Swim cap", "다이빙|Diving", "레인|Lanes", "소독약 냄새|Chlorine smell"],
      ["캠핑장", "Campsite", "텐트|Tent", "모닥불|Campfire", "마시멜로|Marshmallows", "별 보기|Stargazing", "바비큐|Barbecue"],
      ["박물관", "Museum", "유물|Artifacts", "전시|Exhibits", "조용히 관람|Quiet viewing", "공룡 뼈|Dinosaur bones", "견학|Field trip"],
      ["찜질방", "Sauna", "양머리|Towel hat", "식혜|Sweet rice drink", "땀|Sweat", "맥반석 계란|Baked eggs", "뜨끈뜨끈|Toasty warm"],
      ["동물원", "Zoo", "사육사|Zookeeper", "우리|Cages", "기린|Giraffes", "소풍|Picnic", "먹이 주기|Feeding time"],
      ["시장", "Market", "흥정|Bargaining", "상인|Vendors", "덤|A little extra", "북적북적|Bustling", "장바구니|Shopping basket"],
      ["빵집", "Bakery", "갓 구운|Freshly baked", "고소한 냄새|Smells of bread", "쟁반과 집게|Tray and tongs", "제빵사|Baker", "크루아상|Croissant"]
    ]),
  cat("jobs", "직업", "Jobs", "🧑‍🔧",
    ["일한다|Hard work", "월급|Paycheck", "유니폼|A uniform", "꿈|Dream job", "자격증|Needs a license", "사람을 돕는다|Helps people",
      "바쁘다|Busy", "멋있다|Cool"], [
      ["의사", "Doctor", "청진기|Stethoscope", "흰 가운|White coat", "진료|Checkup", "처방전|Prescription", "수술|Surgery"],
      ["소방관", "Firefighter", "불|Fire", "사다리차|Ladder truck", "119|Emergency call", "출동|Dispatch", "구조|Rescue"],
      ["경찰관", "Police officer", "순찰차|Patrol car", "수갑|Handcuffs", "112|Dial 112", "도둑 잡기|Catches thieves", "제복|Uniform"],
      ["요리사", "Chef", "주방|Kitchen", "칼질|Chopping", "하얀 모자|Tall white hat", "레시피|Recipe", "맛보기|Tasting"],
      ["선생님", "Teacher", "칠판|Blackboard", "학생|Students", "숙제 검사|Checks homework", "수업|Lessons", "출석부|Roll call"],
      ["가수", "Singer", "노래|Songs", "마이크|Microphone", "무대|Stage", "앨범|Album", "콘서트|Concerts"],
      ["우주비행사", "Astronaut", "우주복|Space suit", "로켓|Rocket", "무중력|Zero gravity", "달 착륙|Moon landing", "나사|NASA"],
      ["농부", "Farmer", "밭|Fields", "트랙터|Tractor", "수확|Harvest", "씨앗|Seeds", "허수아비|Scarecrow"],
      ["미용사", "Hairdresser", "가위|Scissors", "파마|Perm", "염색|Hair dye", "드라이기|Blow dryer", "샴푸|Shampoo"],
      ["조종사", "Pilot", "조종석|Cockpit", "기장|Captain", "활주로|Runway", "하늘|The sky", "승무원|Cabin crew"],
      ["우체부", "Mail carrier", "편지|Letters", "소포|Parcels", "빨간 자전거|Red bike", "배달|Deliveries", "우체국|Post office"],
      ["화가", "Painter", "붓|Brush", "물감|Paints", "캔버스|Canvas", "이젤|Easel", "미술관|Gallery"],
      ["운동선수", "Athlete", "금메달|Gold medal", "훈련|Training", "올림픽|Olympics", "체력|Stamina", "국가대표|National team"],
      ["과학자", "Scientist", "실험실|Lab", "현미경|Microscope", "연구|Research", "노벨상|Nobel Prize", "가설|Hypothesis"],
      ["마술사", "Magician", "모자 속 토끼|Rabbit from a hat", "카드 묘기|Card tricks", "지팡이|Wand", "짠!|Ta-da!", "사라지다|Vanish"],
      ["제빵사", "Baker", "밀가루|Flour", "오븐|Oven", "새벽 출근|Early mornings", "반죽|Dough", "식빵|Bread loaf"]
    ]),
  cat("sports", "운동", "Sports", "⚽",
    ["건강|Healthy", "경기|A match", "선수|Players", "팀|Teams", "운동복|Sportswear", "체육 시간|PE class", "응원|Cheering",
      "규칙|Rules"], [
      ["축구", "Soccer", "골키퍼|Goalkeeper", "월드컵|World Cup", "11명|Eleven players", "손 금지|No hands", "페널티킥|Penalty kick"],
      ["야구", "Baseball", "홈런|Home run", "투수|Pitcher", "9회|Nine innings", "글러브|Glove", "방망이|Bat"],
      ["농구", "Basketball", "덩크슛|Slam dunk", "키 큰 선수|Tall players", "3점슛|Three-pointer", "드리블|Dribble", "골대 그물|Hoop"],
      ["배구", "Volleyball", "스파이크|Spike", "네트|Net", "서브|Serve", "블로킹|Block", "리베로|Libero"],
      ["테니스", "Tennis", "라켓|Racket", "윔블던|Wimbledon", "노란 공|Yellow ball", "듀스|Deuce", "코트|Court"],
      ["수영", "Swimming", "자유형|Freestyle", "물안경|Goggles", "접영|Butterfly stroke", "물속|Underwater", "레인|Lanes"],
      ["태권도", "Taekwondo", "띠|Belt", "도복|Dobok", "발차기|Kicks", "격파|Board breaking", "품새|Forms"],
      ["골프", "Golf", "홀인원|Hole in one", "클럽|Clubs", "잔디|Green grass", "티샷|Tee shot", "캐디|Caddie"],
      ["스키", "Skiing", "눈|Snow", "슬로프|Slope", "곤돌라|Chairlift", "고글|Goggles", "폴|Poles"],
      ["탁구", "Table tennis", "핑퐁|Ping-pong", "작은 공|Tiny light ball", "스매싱|Smash", "탁자 위|On a table", "중국 강세|China dominates"],
      ["볼링", "Bowling", "핀|Pins", "스트라이크|Strike", "거터|Gutter", "무거운 공|Heavy ball", "신발 대여|Rental shoes"],
      ["마라톤", "Marathon", "42.195km|42.195 km", "장거리|Long distance", "완주|Finish line", "급수대|Water stations", "땀|Sweat"],
      ["요가", "Yoga", "매트|Mat", "스트레칭|Stretching", "명상|Meditation", "유연함|Flexible", "호흡|Breathing"],
      ["배드민턴", "Badminton", "셔틀콕|Shuttlecock", "깃털 공|Feather ball", "공원|In the park", "높이 치기|High clear", "가벼운 라켓|Light racket"],
      ["복싱", "Boxing", "링|Ring", "펀치|Punch", "케이오|Knockout", "샌드백|Punching bag", "글러브|Gloves"],
      ["스케이트", "Skating", "빙판|Ice rink", "김연아|Yuna Kim", "트리플 악셀|Triple axel", "회전|Spins", "날|Blades"]
    ]),
  cat("things", "물건", "Things", "🧰",
    ["집에 있다|At home", "매일 쓴다|Use it daily", "편리하다|Handy", "손으로|By hand", "가게에서 산다|Buy it in a shop",
      "오래 쓴다|Lasts long", "선물|Gift idea", "필요해요|I need it"], [
      ["우산", "Umbrella", "비 오는 날|Rainy day", "펼치다|Open it up", "접이식|Folding", "손잡이|Handle", "장마|Monsoon"],
      ["휴대폰", "Phone", "충전|Charging", "카톡|Messenger", "액정|Screen", "셀카|Selfie", "알람|Alarm"],
      ["냉장고", "Fridge", "차갑다|Cold", "문 두 개|Two doors", "반찬|Side dishes", "냉동실|Freezer", "자석|Magnets"],
      ["칫솔", "Toothbrush", "치약|Toothpaste", "양치|Brush teeth", "하루 세 번|Three times a day", "욕실|Bathroom", "솔|Bristles"],
      ["안경", "Glasses", "렌즈|Lenses", "시력|Eyesight", "코 받침|Nose pads", "김 서림|Fogs up", "안과|Eye doctor"],
      ["시계", "Clock", "째깍째깍|Tick tock", "시침|Hour hand", "알람|Alarm", "벽에 걸다|On the wall", "배터리|Battery"],
      ["베개", "Pillow", "잠|Sleep", "침대|Bed", "푹신|Fluffy", "솜|Stuffing", "머리 받침|Rest your head"],
      ["가위", "Scissors", "자르다|Cut", "종이|Paper", "날카롭다|Sharp", "미용실|Hair salon", "손가락 구멍|Finger holes"],
      ["거울", "Mirror", "반사|Reflects light", "화장|Makeup", "백설공주|Snow White", "세면대|Above the sink", "내 얼굴|My face"],
      ["지갑", "Wallet", "돈|Money", "카드|Cards", "주머니|Pocket", "가죽|Leather", "잃어버리다|Easy to lose"],
      ["가방", "Bag", "메다|Carry it", "지퍼|Zipper", "어깨|Shoulder", "소지품|Belongings", "백팩|Backpack"],
      ["텔레비전", "TV", "리모컨|Remote", "채널|Channels", "드라마|Dramas", "거실|Living room", "화면|Screen"],
      ["연필", "Pencil", "지우개|Eraser", "흑연|Graphite", "깎다|Sharpen", "필기|Writing", "노란색|Yellow"],
      ["의자", "Chair", "앉다|Sit", "다리 네 개|Four legs", "책상|Desk", "등받이|Backrest", "바퀴|Wheels"],
      ["컴퓨터", "Computer", "키보드|Keyboard", "마우스|Mouse", "모니터|Monitor", "인터넷|Internet", "게임|Games"],
      ["숟가락", "Spoon", "국물|Soup", "젓가락|Chopsticks", "밥 먹기|Eating", "은|Silver", "떠먹다|Scoop"]
    ]),
  cat("vehicles", "탈것", "Vehicles", "🚗",
    ["빠르다|Fast", "타고 간다|Ride it", "여행|Travel", "운전|Driving", "출발|Departure", "탑승|Boarding", "사람을 태운다|Carries people",
      "소리가 난다|Makes noise"], [
      ["자전거", "Bicycle", "페달|Pedals", "바퀴 두 개|Two wheels", "헬멧|Helmet", "따릉이|Bike share", "체인|Chain"],
      ["버스", "Bus", "정류장|Stops", "노선|Routes", "하차벨|Stop button", "교통카드|Transit card", "2층|Double-decker"],
      ["지하철", "Subway", "환승|Transfer", "노선도|Line map", "출퇴근|Commute", "땅속|Underground", "스크린도어|Platform doors"],
      ["비행기", "Airplane", "날개|Wings", "이륙|Takeoff", "기내식|In-flight meal", "활주로|Runway", "창가 좌석|Window seat"],
      ["유람선", "Cruise ship", "바다|Sea", "선장|Captain", "갑판|Deck", "항구|Harbor", "뱃멀미|Seasick"],
      ["기차", "Train", "칙칙폭폭|Choo-choo", "철로|Railway", "역|Station", "KTX|KTX", "객실|Carriages"],
      ["택시", "Taxi", "미터기|Meter", "기본요금|Base fare", "손 흔들기|Hail it", "기사님|Driver", "노란색|Yellow"],
      ["헬리콥터", "Helicopter", "프로펠러|Rotor blades", "공중 정지|Hovers", "구조|Rescue", "옥상|Rooftop", "두두두|Chop chop"],
      ["오토바이", "Motorcycle", "헬멧|Helmet", "배달|Delivery", "두 바퀴|Two wheels", "부릉부릉|Vroom", "가죽 재킷|Leather jacket"],
      ["로켓", "Rocket", "발사|Launch", "카운트다운|Countdown", "우주|Space", "연료|Fuel", "불꽃|Flames"],
      ["잠수함", "Submarine", "바닷속|Under the sea", "잠망경|Periscope", "해군|Navy", "소나|Sonar", "깊이|Deep"],
      ["트럭", "Truck", "짐|Cargo", "택배|Parcels", "큰 바퀴|Big wheels", "이삿짐|Moving day", "고속도로|Highway"],
      ["소방차", "Fire truck", "빨간색|Red", "사이렌|Siren", "사다리|Ladder", "호스|Hose", "119|Emergency"],
      ["열기구", "Hot-air balloon", "바구니|Basket", "둥실둥실|Floating", "카파도키아|Cappadocia", "하늘 위|High in the sky", "불꽃|Burner flame"],
      ["킥보드", "Scooter", "전동|Electric", "한 발로|One foot", "공유|Rental app", "핸들|Handlebar", "인도|Sidewalk"],
      ["구급차", "Ambulance", "응급|Emergency", "들것|Stretcher", "삐뽀삐뽀|Nee-naw", "사이렌|Siren", "병원|Hospital"]
    ]),
  cat("produce", "과일·채소", "Fruit & veg", "🥕",
    ["건강하다|Healthy", "마트|Grocery store", "씻어 먹기|Wash it first", "농장|Farm", "색깔이 예쁨|Pretty color", "제철|In season",
      "샐러드|Salad", "자연|Nature"], [
      ["사과", "Apple", "빨갛다|Red", "뉴턴|Newton", "아삭|Crunchy", "백설공주|Snow White", "껍질|Peel"],
      ["바나나", "Banana", "노랗다|Yellow", "원숭이|Monkeys", "길쭉|Long", "껍질|Peel", "송이|Bunch"],
      ["딸기", "Strawberry", "씨가 겉에|Seeds outside", "빨갛다|Red", "생크림 케이크|Shortcake", "봄|Spring", "하우스|Greenhouse"],
      ["수박", "Watermelon", "여름|Summer", "줄무늬|Stripes", "씨 뱉기|Spit the seeds", "크다|Huge", "시원하다|Refreshing"],
      ["포도", "Grapes", "보라색|Purple", "송이송이|Clusters", "주스|Juice", "알알이|Bead-like", "껍질째|Eat skin and all"],
      ["오렌지", "Orange", "비타민 C|Vitamin C", "상큼|Tangy", "캘리포니아|California", "주스|Juice", "껍질 까기|Peel it"],
      ["당근", "Carrot", "주황색|Orange colour", "토끼|Rabbits", "뿌리|Root", "눈에 좋다|Good for eyes", "아삭아삭|Crunchy"],
      ["감자", "Potato", "땅속|Underground", "찐 것|Steamed", "포슬포슬|Fluffy", "칩|Chips", "강원도|Gangwon-do"],
      ["양파", "Onion", "눈물|Tears", "겹겹이|Layers", "매운 냄새|Sharp smell", "링|Rings", "볶음|Stir-fry"],
      ["토마토", "Tomato", "케첩|Ketchup", "빨갛다|Red", "과일? 채소?|Fruit or veg?", "스파게티|Spaghetti sauce", "방울|Cherry-sized"],
      ["복숭아", "Peach", "분홍색|Pink", "털|Fuzzy skin", "달콤|Sweet", "여름|Summer", "말랑말랑|Soft"],
      ["파인애플", "Pineapple", "뾰족뾰족|Spiky", "하와이|Hawaii", "노란 속|Yellow inside", "피자 토핑|Pizza topping", "열대|Tropical"],
      ["오이", "Cucumber", "초록색|Green", "피클|Pickles", "시원하다|Refreshing", "얼굴 팩|Face mask", "길쭉|Long"],
      ["브로콜리", "Broccoli", "작은 나무|Tiny tree", "초록색|Green", "데치다|Blanch it", "건강|Healthy", "애들이 싫어함|Kids hate it"],
      ["고구마", "Sweet potato", "겨울 간식|Winter snack", "답답함|Frustrating", "주황 속|Orange inside", "달콤|Sweet", "군것질|Roasted on the street"],
      ["레몬", "Lemon", "시다|Sour", "비타민|Vitamins", "홍차|With tea", "상큼|Zesty", "노랗다|Yellow"]
    ]),
  cat("countries", "나라", "Countries", "🌏",
    ["여행|Travel", "비행기 타고|By plane", "외국|Abroad", "수도|Capital city", "언어|Language", "국기|Flag", "유명한 음식|Famous food",
      "관광지|Tourist spots"], [
      ["미국", "USA", "자유의 여신상|Statue of Liberty", "햄버거|Burgers", "할리우드|Hollywood", "달러|Dollars", "뉴욕|New York"],
      ["일본", "Japan", "초밥|Sushi", "도쿄|Tokyo", "벚꽃|Cherry blossoms", "엔화|Yen", "후지산|Mt. Fuji"],
      ["중국", "China", "만리장성|Great Wall", "판다|Pandas", "베이징|Beijing", "인구|Huge population", "자금성|Forbidden City"],
      ["프랑스", "France", "에펠탑|Eiffel Tower", "파리|Paris", "바게트|Baguette", "루브르|Louvre", "마카롱|Macarons"],
      ["영국", "UK", "런던|London", "빅벤|Big Ben", "여왕|The Queen", "홍차|Afternoon tea", "이층 버스|Red double-decker"],
      ["이탈리아", "Italy", "피자|Pizza", "로마|Rome", "콜로세움|Colosseum", "파스타|Pasta", "베네치아|Venice"],
      ["브라질", "Brazil", "축구|Soccer", "삼바|Samba", "아마존|Amazon", "리우|Rio", "커피|Coffee"],
      ["호주", "Australia", "캥거루|Kangaroos", "시드니|Sydney", "코알라|Koalas", "오페라 하우스|Opera House", "남반구|Southern Hemisphere"],
      ["이집트", "Egypt", "피라미드|Pyramids", "스핑크스|Sphinx", "나일강|The Nile", "미라|Mummies", "사막|Desert"],
      ["인도", "India", "카레|Curry", "타지마할|Taj Mahal", "갠지스강|Ganges", "요가|Yoga", "향신료|Spices"],
      ["캐나다", "Canada", "단풍잎|Maple leaf", "메이플 시럽|Maple syrup", "나이아가라|Niagara Falls", "밴쿠버|Vancouver", "아이스하키|Ice hockey"],
      ["독일", "Germany", "소시지|Sausages", "베를린|Berlin", "자동차|Cars", "아우토반|Autobahn", "프레첼|Pretzels"],
      ["스페인", "Spain", "투우|Bullfighting", "플라멩코|Flamenco", "파에야|Paella", "바르셀로나|Barcelona", "마드리드|Madrid"],
      ["러시아", "Russia", "마트료시카|Nesting dolls", "추운 나라|Very cold", "모스크바|Moscow", "넓은 땅|Huge land", "발레|Ballet"],
      ["멕시코", "Mexico", "타코|Tacos", "솜브레로|Sombrero", "선인장|Cactus", "마야|Maya ruins", "매운 소스|Hot sauce"],
      ["베트남", "Vietnam", "쌀국수|Pho", "하롱베이|Ha Long Bay", "오토바이|Scooters", "논라|Conical hat", "다낭|Da Nang"]
    ]),
  cat("music", "악기", "Instruments", "🎻",
    ["소리|Sound", "음악|Music", "연주|Perform", "공연|Concert", "연습|Practice", "배우기 어렵다|Hard to learn", "악보|Sheet music",
      "멋진 소리|Nice sound"], [
      ["피아노", "Piano", "건반|Keys", "흑백|Black and white", "페달|Pedals", "쇼팽|Chopin", "그랜드|Grand"],
      ["기타", "Guitar", "줄 여섯 개|Six strings", "코드|Chords", "피크|Pick", "밴드|Band", "튕기다|Strum"],
      ["바이올린", "Violin", "활|Bow", "턱에 대고|Under the chin", "오케스트라|Orchestra", "줄 네 개|Four strings", "비발디|Vivaldi"],
      ["드럼", "Drums", "스틱|Sticks", "쿵쿵|Boom boom", "심벌즈|Cymbals", "박자|Beat", "밴드|Band"],
      ["플루트", "Flute", "은색|Silver", "옆으로 불기|Held sideways", "새소리|Birdsong", "숨|Breath", "목관|Woodwind"],
      ["트럼펫", "Trumpet", "금관|Brass", "빵빠레|Fanfare", "밸브|Valves", "루이 암스트롱|Louis Armstrong", "입술 떨기|Buzzing lips"],
      ["하모니카", "Harmonica", "입으로|Mouth", "작다|Pocket-sized", "들숨 날숨|Blow and draw", "구멍|Holes", "블루스|Blues"],
      ["리코더", "Recorder", "음악 시간|Music class", "초등학교|Elementary school", "구멍|Holes", "플라스틱|Plastic", "삑사리|Squeaky"],
      ["첼로", "Cello", "크다|Large", "앉아서|Played seated", "낮은 소리|Deep tone", "활|Bow", "다리 사이|Between the knees"],
      ["가야금", "Gayageum", "열두 줄|Twelve strings", "국악|Korean music", "뜯다|Pluck", "한복|Hanbok", "전통|Traditional"],
      ["장구", "Janggu", "덩더쿵|Deong-deo-kung", "사물놀이|Samulnori", "모래시계 모양|Hourglass shape", "국악|Korean music", "채|Stick"],
      ["탬버린", "Tambourine", "노래방|Karaoke", "흔들기|Shake it", "짤랑짤랑|Jingle", "동그랗다|Round", "박수|Clap along"],
      ["실로폰", "Xylophone", "나무 건반|Wooden bars", "도레미|Do-re-mi", "채|Mallets", "무지개색|Rainbow colors", "유치원|Kindergarten"],
      ["트라이앵글", "Triangle", "세모|Three sides", "땡|Ting!", "쇠막대|Metal rod", "작은 소리|Tiny sound", "유치원|Kindergarten"],
      ["색소폰", "Saxophone", "재즈|Jazz", "금색|Golden", "리드|Reed", "구부러짐|Curved", "케니 지|Kenny G"],
      ["하프", "Harp", "천사|Angels", "줄이 많다|Many strings", "우아함|Elegant", "세워서|Stands tall", "손가락|Fingers"]
    ])
];

/* Last-resort hints when a word's own and the category's hints have all been used */
export const UNIVERSAL = ["음…|Hmm…", "좋아요|I like it", "흔하다|Common", "익숙함|Familiar", "유명해요|Famous", "다들 알죠|Everyone knows it",
  "생각 중|Thinking…"].map(pair);

/* ---------- Text helpers ---------- */
/* What a typed hint becomes: no control characters, no braces (they would read as name placeholders), single spaces */
export function normHint(s) {
  return String(s ?? "").normalize("NFC")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu, "")
    .replace(/[{}<>]/g, "").replace(/\s+/g, " ").trim();
}
export const hintLen = s => [...String(s)].length;
/* Lower case, no spaces or punctuation — for comparing */
export const squash = s => String(s ?? "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const tokens = s => String(s ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/* Does the text give the word away? Korean: the word appears anywhere (spaces ignored).
   English: the word appears as whole word(s) — spaces between its parts optional, simple plurals count ("cats", "ice-cream"). */
export function containsWord(text, w) {
  if (!w) return false;
  const k = squash(w.ko);
  if (k && squash(text).includes(k)) return true;
  const target = tokens(w.en).join("");
  if (!target) return false;
  const t = tokens(text);
  for (let i = 0; i < t.length; i++) {
    let s = "";
    for (let j = i; j < t.length && s.length < target.length + 2; j++) {
      s += t[j];
      if (s === target || s === target + "s" || s === target + "es" || s + "s" === target) return true;
    }
  }
  return false;
}

/* A hint as given: a typed string (any language) or an AI's bilingual {ko, en} */
export const hintTexts = h => (typeof h === "string" ? [h] : [h.ko, h.en]);
/* Does hint h equal one of the bilingual hints in list (either language, spaces and case ignored)? */
export function hintIn(h, list) {
  const keys = hintTexts(h).map(squash).filter(Boolean);
  return list.some(x => keys.includes(squash(x.ko)) || keys.includes(squash(x.en)));
}

/* Loose relatedness for free-typed hints: shared Korean syllable pairs or shared English words (3+ letters) */
const STOP = new Set(["the", "and", "for", "with", "you", "its", "it's", "has", "are", "very", "big", "one", "two", "eat", "lot", "lots", "like"]);
function feats(texts) {
  const f = new Set();
  for (const s of texts) {
    const ko = String(s).replace(/[^가-힣]/g, "");
    for (let i = 0; i + 1 < ko.length; i++) f.add(ko.slice(i, i + 2));
    for (const t of tokens(s)) if (/^[a-z0-9]+$/.test(t) && t.length >= 3 && !STOP.has(t)) f.add(t.replace(/(es|s)$/, ""));
  }
  return f;
}
const featCache = new Map();
export function wordFeats(ci, wi) {
  const key = ci * 100 + wi;
  if (!featCache.has(key)) {
    const W = CATS[ci].words[wi];
    featCache.set(key, feats([W.w.ko, W.w.en, ...W.h.flatMap(x => [x.ko, x.en])]));
  }
  return featCache.get(key);
}
export function relatedTo(h, F) {
  for (const x of feats(hintTexts(h))) if (F.has(x)) return true;
  return false;
}
