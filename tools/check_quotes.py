import glob
for f in glob.glob('web/**/*.js', recursive=True):
    s=open(f,encoding='utf-8').read()
    sq=s.count("'")
    dq=s.count('"')
    if sq%2!=0 or dq%2!=0:
        print(f, "single",sq,"double",dq)
